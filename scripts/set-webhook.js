#!/usr/bin/env node
require('dotenv').config();
const https = require('https');

const token = process.env.TELEGRAM_BOT_TOKEN_TEST;
const endpoint = process.env.NGROK_APP_ENDPOINT;

if (!token || !endpoint) {
    console.error('❌ TELEGRAM_BOT_TOKEN_TEST or NGROK_APP_ENDPOINT is missing in .env');
    process.exit(1);
}

const webhookUrl = `${endpoint}/`;
const apiUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

console.log(`🔗 Setting webhook: ${webhookUrl}`);

https.get(apiUrl, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const result = JSON.parse(data);
        if (result.ok) {
            console.log('✅ Webhook set successfully');
        } else {
            console.error('❌ Failed to set webhook:', result.description);
            process.exit(1);
        }
    });
}).on('error', (err) => {
    console.error('❌ Request failed:', err.message);
    process.exit(1);
});
