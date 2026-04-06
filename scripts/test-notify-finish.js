#!/usr/bin/env node
/**
 * Test script: simulate FACEIT match_status_finished webhook for local testing.
 *
 * Usage:
 *   npm run test-notify-finish -- --nickname <faceit_nickname> [options]
 *
 * Options:
 *   --port    <port>    Local server port (default: 8080)
 *   --secret  <secret>  FACEIT webhook secret (or FACEIT_WEBHOOK_SECRET env var)
 *   --matchId <id>      Use specific finished match ID
 *
 * Notes:
 * - Script posts event to local webhook endpoint.
 * - Bot now sends one finish notification per match+chat.
 * - Notification includes stats for all subscribed players from that match.
 * - Joke lines are included only for players with ELO < 2000.
 */

require('dotenv').config();
const https = require('https');
const http = require('http');

// -- CLI args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
        const key = argv[i].slice(2);
        args[key] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    }
}

const NICKNAME = args.nickname;
const PORT = parseInt(args.port || '8080', 10);
const SECRET = args.secret || process.env.FACEIT_WEBHOOK_SECRET || '';
const MATCH_ID = args.matchId || null;
const API_KEY = process.env.FACEIT_API_KEY;

if (!NICKNAME) {
    console.error('Usage: npm run test-notify-finish -- --nickname <nick> [--matchId <id>] [--port 8080] [--secret <secret>]');
    process.exit(1);
}
if (!API_KEY) {
    console.error('Error: FACEIT_API_KEY not set in environment / .env');
    process.exit(1);
}

// -- FACEIT API helper ---------------------------------------------------------
async function faceitGet(path) {
    return new Promise((resolve, reject) => {
        const req = https.get({
            hostname: 'open.faceit.com',
            path: `/data/v4${path}`,
            headers: { Authorization: `Bearer ${API_KEY}` },
        }, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
                if (res.statusCode === 404) return resolve(null);
                if (res.statusCode !== 200) return reject(new Error(`FACEIT API ${res.statusCode}: ${path}`));
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
    });
}

// -- POST fake webhook ---------------------------------------------------------
async function postWebhook(payload) {
    const body = JSON.stringify({ event: 'match_status_finished', payload });
    return new Promise((resolve, reject) => {
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
        };
        if (SECRET) headers['x-faceit-webhook-secret'] = SECRET;

        const req = http.request({
            hostname: 'localhost',
            port: PORT,
            path: '/webhook/faceit',
            method: 'POST',
            headers,
        }, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// -- Main ----------------------------------------------------------------------
(async () => {
    console.log(`\nLooking up player "${NICKNAME}" on FACEIT...`);
    const player = await faceitGet(`/players?nickname=${encodeURIComponent(NICKNAME)}&game=cs2`);
    if (!player) {
        console.error('Player not found');
        process.exit(1);
    }

    const playerId = player.player_id;
    console.log(`Found: ${player.nickname} (${playerId})`);

    let matchId = MATCH_ID;
    let match;

    if (matchId) {
        console.log(`Using provided matchId: ${matchId}`);
        match = await faceitGet(`/matches/${matchId}`);
        if (!match) {
            console.error('Match not found');
            process.exit(1);
        }
    } else {
        console.log('Fetching recent match history...');
        const statsResp = await faceitGet(`/players/${playerId}/games/cs2/stats?limit=5`);
        const items = statsResp?.items || [];
        matchId = items[0]?.stats?.['Match Id'];
        if (!matchId) {
            console.error('No recent matches found');
            process.exit(1);
        }

        match = await faceitGet(`/matches/${matchId}`);
        if (!match) {
            console.error('Match details not found');
            process.exit(1);
        }
    }

    const f1 = match.teams?.faction1;
    const f2 = match.teams?.faction2;
    console.log(`Match: ${matchId}`);
    console.log(`Teams: ${f1?.name || 'Team 1'} vs ${f2?.name || 'Team 2'}`);

    const webhookPayload = { ...match, id: match.match_id || match.id };

    console.log(`\nPosting fake match_status_finished webhook to http://localhost:${PORT}/webhook/faceit ...`);
    const result = await postWebhook(webhookPayload);

    if (result.status === 200) {
        console.log(`Webhook accepted (HTTP ${result.status})`);
        console.log('\nExpected behavior:');
        console.log('1. One finish notification per chat for this match');
        console.log('2. Notification includes all subscribed players from this match');
        console.log('3. Joke lines only for players with ELO < 2000');
        console.log('\nTip: make sure multiple players from this match are subscribed in the same chat.');
    } else {
        console.error(`Webhook rejected (HTTP ${result.status}): ${result.body}`);
    }
})().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});