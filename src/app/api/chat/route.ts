import { NextRequest, NextResponse } from 'next/server';
import { searchHistoricalMaterials, searchRandomMaterial } from '@/lib/ndl-api';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: NextRequest) {
    try {
        const { message } = await req.json();

        // 1. Geminiを使用して、検索クエリと注目キーワード（複数）を抽出
        const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
        const extractionPrompt = `
      ユーザーの質問から、国立国会図書館の歴史資料を検索するための情報を抽出してください。
      あなたは歴史と地域文化に精通した案内人です。質問に含まれる単語を「歴史的な関連語」へ能動的に広げて抽出してください。

      【知識拡張の例】
      - 地名: 「愛知県」→「尾張」「三河」「名古屋」「犬山」「津島」など旧国名や主要都市
      - 現象: 「体調不良」「病気」→「憑物」「狐憑」「障り」「祟り」「病魔」「邪気」「物の怪」「死霊」
      - 事件: 「犯罪」「事件」→「裁判」「実録」「奇談」「珍事」「獄」「騒動」
      - ジャンル: 「怪異」→「怪談」「奇談」「百物語」「怪異」「化物」「幽霊」「不思議」

      【出力形式】
      以下のJSON形式で出力してください：
      {
        "query": "書籍検索用のクエリ。地名やジャンルなどを組み合わせた2〜3語（例：'尾張 怪談'）",
        "focusKeywords": ["資料内検索用の具体的単語（5〜8個）。拡張した関連語を多く含める"],
        "isRandom": ユーザーが「ランダムに」「何か一つ」などを望んでいる場合は true、それ以外は false
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

        const extractionResult = await generateContentWithRetry(model, extractionPrompt);
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
            const failResult = await generateContentWithRetry(model, failPrompt);
            reply = failResult.response.text();

            return NextResponse.json({ reply, sources: [] });
        }

        const materialsContext = materials.map((m, i) =>
            `資料${i + 1}: ${m.title} (コマ番号: ${m.page})\n内容: ${m.snippet}`
        ).join('\n\n');

        const completionPrompt = `
          あなたは江戸〜明治時代の資料に通じた歴史案内人です。
          以下の資料断片（スニペット）を読み解き、ユーザーの問い「${message}」に対して、
          興味深い物語を語るように、趣のある日本語で解説してください。
          
          【資料内容】
          ${materialsContext}
          
          【回答の重要ルール：インライン引用】
          - 資料の内容に触れる際、その根拠となる資料の番号（1, 2...）を使い、対象の語句を必ず以下の形式で囲ってください。
          - 形式: <cite id="資料番号">対象語句</cite>
          
          【解説の指針】
          - 珍事、奇談、世相を反映した事件の記録など、歴史の闇や不思議さに焦点を当てて語ってください。
          - OCRの誤字は文脈から推測して補完し、当時の空気感が伝わるようにしてください。
          - 歴史の案内人として、少し古風な（しかし分かりやすい）口調を崩さないでください。
        `;

        const finalResult = await generateContentWithRetry(model, completionPrompt);
        reply = finalResult.response.text();

        return NextResponse.json({
            reply,
            sources: materials
        });

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error.message || '予期せぬエラーが発生しました。'
        }, { status: 500 });
    }
}
