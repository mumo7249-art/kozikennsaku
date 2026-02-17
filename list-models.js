const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
    try {
        // Note: The library doesn't always have a direct listModels, 
        // but we can try to fetch it via the REST API or see if the error message gives a hint.
        // Actually, let's just try the most common ones.
        const models = ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro', 'gemini-pro'];
        for (const m of models) {
            try {
                const model = genAI.getGenerativeModel({ model: m });
                const result = await model.generateContent('test');
                console.log(`Model ${m}: SUCCESS`);
                break;
            } catch (e) {
                console.log(`Model ${m}: FAILED (${e.message})`);
            }
        }
    } catch (error) {
        console.error(error);
    }
}

listModels();
