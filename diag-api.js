const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const path = require('path');

// .env.local を明示的に読み込む
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error('Error: GEMINI_API_KEY is not set in .env.local');
    process.exit(1);
}

console.log('API Key Found (First 5 chars):', apiKey.substring(0, 5) + '...');

const genAI = new GoogleGenerativeAI(apiKey);

async function test() {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent('Hi, are you working?');
        console.log('Response Success!');
        console.log('Gemini Reply:', result.response.text());
    } catch (error) {
        console.error('API Call Failed:');
        console.error('Status:', error.status);
        console.error('Message:', error.message);
    }
}

test();
