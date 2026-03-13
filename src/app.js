const express = require('express');
const { handleWebhook } = require('./handlers/webhookHandler');

const app = express();

app.use(express.json());

// Telegram webhook handler
app.post('/', handleWebhook);

// Health check handler
app.get('/', (req, res) => {
    res.status(200).send('OK');
});

module.exports = app;
