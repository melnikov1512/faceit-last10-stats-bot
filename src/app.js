const express = require('express');
const { handleWebhook } = require('./handlers/webhookHandler');
const { handleFaceitWebhook } = require('./handlers/faceitWebhookHandler');

const app = express();

app.use(express.json());

// Telegram webhook handler
app.post('/', handleWebhook);

// FACEIT webhook handler
app.post('/webhook/faceit', handleFaceitWebhook);

// Health check handler
app.get('/', (req, res) => {
    res.status(200).send('OK');
});

module.exports = app;
