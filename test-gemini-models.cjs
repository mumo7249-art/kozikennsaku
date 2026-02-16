const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config({ path: '.env.local' });

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
        // v1beta のエンドポイントを直接叩いてモデル一覧を取得する手段がSDKにあるか確認
        // ひとまず2.0-flash、1.5-flash、1.5-proなどを試して動作を確認するのが手っ取り早い

        const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'];

        for (const modelName of models) {
            console.log(`Testing model: ${modelName}...`);
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent('Hi');
                console.log(`  SUCCESS: ${modelName} is available.`);
                break;
            } catch (e) {
                console.log(`  FAILED: ${modelName} - ${e.message}`);
            }
        }
    } catch (error) {
        console.error('ListModels Error:', error);
    }
}

listModels();
