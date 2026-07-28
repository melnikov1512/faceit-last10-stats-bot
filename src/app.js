const path = require('path');
const express = require('express');
const { handleWebhook } = require('./handlers/webhookHandler');
const { handleFaceitWebhook } = require('./handlers/faceitWebhookHandler');
const { getActiveMatches, getMatch } = require('./handlers/apiHandler');

const app = express();

app.use(express.json({ limit: '1mb' }));

// Serve the web app at /app
app.use('/app', express.static(path.join(__dirname, '..', 'public')));

// Telegram webhook handler
app.post('/', handleWebhook);

// FACEIT webhook handler
app.post('/webhook/faceit', handleFaceitWebhook);

// REST API: active matches for a chat
app.get('/api/active-matches', getActiveMatches);

// REST API: single match by ID (always, even if finished)
app.get('/api/match', getMatch);



// Health check (explicit path so static middleware doesn't shadow it)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// TEMPORARY DEBUG ROUTE — remove after inspecting live ELO timeline response.
// Gated behind FACEIT_WEBHOOK_SECRET (already a required prod secret) so it's not wide open.
app.get('/debug/elo-timeline', async (req, res) => {
    if (req.query.secret !== process.env.FACEIT_WEBHOOK_SECRET) {
        return res.status(403).send('Forbidden');
    }
    const playerId = req.query.playerId || '8511f100-479d-4d31-b2b5-1816a2577924';
    const size = req.query.size || '10';
    try {
        const params = new URLSearchParams({
            size, page: '0', from: '1604676605000', to: '2235828605000',
        });
        const url = `https://api.faceit.com/stats/v1/stats/time/users/${playerId}/games/cs2?${params}`;
        const upstream = await fetch(url, {
            headers: { 'User-Agent': 'PostmanRuntime/7.43.0', 'Accept': '*/*' },
        });
        const text = await upstream.text();
        res.status(200).json({ upstreamStatus: upstream.status, body: JSON.parse(text) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = app;
