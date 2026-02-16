const axios = require('axios');
require('dotenv').config({ path: '.env.local' });

const API_KEY = process.env.GEMINI_API_KEY;
const URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

async function listModelsDirectly() {
    try {
        console.log('Fetching models from:', URL.replace(API_KEY, 'HIDDEN_KEY'));
        const response = await axios.get(URL);

        console.log('--- Available Models ---');
        if (response.data && response.data.models) {
            response.data.models.forEach(m => {
                console.log(`Name: ${m.name}`);
                console.log(`DisplayName: ${m.displayName}`);
                console.log(`SupportedGenerationMethods: ${JSON.stringify(m.supportedGenerationMethods)}`);
                console.log('---');
            });
        } else {
            console.log('No models found in response.');
            console.log(response.data);
        }

    } catch (error) {
        console.error('Error fetching models:', error.response ? error.response.data : error.message);
    }
}

listModelsDirectly();
