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

// TEMPORARY DEBUG ROUTE — remove after inspecting live match-rounds response.
// Gated behind FACEIT_WEBHOOK_SECRET (already a required prod secret) so it's not wide open.
app.get('/debug/match-rounds', async (req, res) => {
    if (req.query.secret !== process.env.FACEIT_WEBHOOK_SECRET) {
        return res.status(403).send('Forbidden');
    }
    const playerId = req.query.playerId || '8511f100-479d-4d31-b2b5-1816a2577924'; // lon_don_mon
    const limit = req.query.limit || '5';
    try {
        const params = new URLSearchParams({ game_mode: '5v5', limit });
        const url = `https://www.faceit.com/api/statistics/v1/cs2/players/${playerId}/match-rounds?${params}`;
        const upstream = await fetch(url, {
            headers: {
                accept: 'application/json+camelcase',
                'faceit-referer': 'web-next',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            signal: AbortSignal.timeout(10000),
        });
        const text = await upstream.text();
        let body;
        try { body = JSON.parse(text); } catch (_) { body = text.slice(0, 2000); }
        res.status(200).json({ upstreamStatus: upstream.status, body });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = app;
