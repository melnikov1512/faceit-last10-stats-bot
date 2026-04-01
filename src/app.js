const path = require('path');
const express = require('express');
const { handleWebhook } = require('./handlers/webhookHandler');
const { handleFaceitWebhook } = require('./handlers/faceitWebhookHandler');
const { getActiveMatches } = require('./handlers/apiHandler');

const app = express();

app.use(express.json());

// Serve the web app at /app
app.use('/app', express.static(path.join(__dirname, '..', 'public')));

// Telegram webhook handler
app.post('/', handleWebhook);

// FACEIT webhook handler
app.post('/webhook/faceit', handleFaceitWebhook);

// REST API: active matches for a chat
app.get('/api/active-matches', getActiveMatches);



// Health check (explicit path so static middleware doesn't shadow it)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

module.exports = app;
