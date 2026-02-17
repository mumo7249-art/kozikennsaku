import { NextRequest, NextResponse } from 'next/server';
import { searchHistoricalMaterials, searchRandomMaterial } from '@/lib/ndl-api';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: NextRequest) {
    try {
        const { message, model: requestedModel } = await req.json();

        // 1. APIキーの優先順位決定 (Header > .env.local)
        const clientKey = req.headers.get('x-gemini-key');
        const envKey = process.env.GEMINI_API_KEY;
        const apiKey = clientKey || envKey;

        if (!apiKey) {
            throw new Error('APIキーが設定されていません。画面右上の設定（歯車）よりAPIキーを入力してください。');
        }

        const genAI = new GoogleGenerativeAI(apiKey);

        // --- 抽出ステップ (Quota節約のためLiteモデル固定) ---
        // ※Liteモデルは制限が極めて緩いため、本命モデルの枠を温存できる
        const extractionModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

        // --- 回答ステップ (ユーザー指定モデル) ---
        const modelName = requestedModel || 'gemini-2.0-flash';
        const finalModel = genAI.getGenerativeModel({ model: modelName });

        // Geminiを使用して、検索クエリと注目キーワード（複数）を抽出
        const extractionPrompt = `
      あなたは専門的な図書館司書です。ユーザーの質問から、国立国会図書館の資料検索に必要な情報をJSON形式で抽出してください。

      【検索のポイント】
      - 質問に含まれる現代的な言葉を、資料が見つかりやすい歴史的名称や関連語に拡張してください（例：地名→旧国名、犯罪→裁判・実録）。
      
      【出力形式】
      {
        "query": "OpenSearch用の2-3語の検索クエリ",
        "focusKeywords": ["スニペット内を特定するためのキーワード5-8個"],
        "isRandom": false
      }
      
      ユーザーの質問: ${message}
    `;

        // 503(High Demand)などの一時的なエラーに対するリトライ
        const generateContentWithRetry = async (targetModel: any, prompt: string, maxRetries = 2) => {
            for (let i = 0; i <= maxRetries; i++) {
                try {
                    return await targetModel.generateContent(prompt);
                } catch (e: any) {
                    const isRetryable = e.message?.includes('503') || e.message?.includes('504') || e.message?.includes('429');
                    if (i < maxRetries && isRetryable) {
                        console.log(`Retrying API call (${i + 1}/${maxRetries}) due to: ${e.message}`);
                        await new Promise(resolve => setTimeout(resolve, 1500 * (i + 1)));
                        continue;
                    }
                    throw e;
                }
            }
        };

        const extractionResult = await generateContentWithRetry(extractionModel, extractionPrompt);
        const extractionText = extractionResult.response.text().replace(/```json|```/g, '').trim();
        let extractionData;
        try {
            extractionData = JSON.parse(extractionText);
        } catch (e) {
            extractionData = { query: message, focusKeywords: [message], isRandom: false };
        }

        const { query, focusKeywords, isRandom } = extractionData;

        // 2. NDL APIで資料を検索
        let materials = [];
        if (isRandom || message.includes('ランダム') || message.includes('何か')) {
            materials = await searchRandomMaterial();
        } else {
            materials = await searchHistoricalMaterials(query, focusKeywords);

            // ヒットしない場合の再試行（より広い「奇談・珍事」キーワードで）
            if (materials.length === 0) {
                console.log("No hits, trying broader search...");
                const broaderQuery = query.split(' ')[0] + " 奇談 珍事 実録";
                materials = await searchHistoricalMaterials(broaderQuery, focusKeywords);
            }
        }

        // 3. 取得したスニペットを基に回答を作成
        let reply = "";
        if (materials.length === 0) {
            const failPrompt = `
              ユーザーは「${message}」という質問をしましたが、資料が見つかりませんでした。
              歴史案内人に成り代わり、お詫びしつつ、「珍事」「実録」「奇談」「裁判」などのキーワードや、
              特定の地名を加えるなどの探索のアドバイスを趣のある口調で伝えてください。
            `;
            const failResult = await generateContentWithRetry(finalModel, failPrompt);
            reply = failResult.response.text();

            return NextResponse.json({ reply, sources: [] });
        }

        const materialsContext = materials.map((m, i) =>
            `資料${i + 1}: ${m.title} (コマ番号: ${m.page})\n内容: ${m.snippet}`
        ).join('\n\n');

        const completionPrompt = `
          あなたは高度な文献解析アシスタントです。提供された資料断片（スニペット）に基づき、ユーザーの問い「${message}」に回答してください。

          【回答ルール】
          - 不要な挨拶や演出は省き、事実に基づき簡潔に記述してください。
          - 根拠となる資料がある語句には、必ず <cite id="資料番号">対象語句</cite> 形式で注釈を付けてください。
          - OCRの誤字は適宜修正して読みやすくしてください。

          【資料内容】
          ${materialsContext}
        `;

        const finalResult = await generateContentWithRetry(finalModel, completionPrompt);
        reply = finalResult.response.text();

        return NextResponse.json({
            reply,
            sources: materials
        });

    } catch (error: any) {
        console.error('API Error:', error);

        // クォータ超過 (429) のハンドリング
        if (error.status === 429 || error.message?.includes('429') || error.message?.includes('quota')) {
            return NextResponse.json({
                error: 'Quota Exceeded',
                details: '現在のモデルの利用制限（無料枠）に達しました。別のモデルに切り替えてお試しください。'
            }, { status: 429 });
        }

        return NextResponse.json({
            error: 'Internal Server Error',
            details: error.message || '予期せぬエラーが発生しました。'
        }, { status: 500 });
    }
}
