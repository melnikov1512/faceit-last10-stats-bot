#!/usr/bin/env node
/**
 * Test script: simulate a FACEIT match_status_ready webhook for local testing.
 *
 * Usage:
 *   node scripts/test-notify.js --nickname <faceit_nickname> --chatId <telegram_chat_id> [options]
 *
 * Options:
 *   --port    <port>    Local server port (default: 8080)
 *   --secret  <secret>  FACEIT webhook secret (or set FACEIT_WEBHOOK_SECRET env var)
 *   --matchId <id>      Use a specific match ID instead of fetching the player's latest
 *   --force             Skip subscription check — send notification directly to chatId via Telegram API
 *
 * Normal mode: POSTs a fake match_status_ready to http://localhost:<port>/webhook/faceit.
 *   The chat must be subscribed to the player via /subscribe for the notification to arrive.
 *
 * --force mode: Sends the Telegram message directly using TELEGRAM_BOT_TOKEN,
 *   bypassing subscription checks. Good for quick UI tests.
 */

require('dotenv').config();
const https = require('https');
const http  = require('http');

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
        const key = argv[i].slice(2);
        args[key] = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
    }
}

const NICKNAME  = args.nickname;
const CHAT_ID   = args.chatId;
const PORT      = parseInt(args.port || '8080', 10);
const SECRET    = args.secret || process.env.FACEIT_WEBHOOK_SECRET || '';
const FORCE     = !!args.force;
const MATCH_ID  = args.matchId || null;
const API_KEY   = process.env.FACEIT_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!NICKNAME || !CHAT_ID) {
    console.error('Usage: node scripts/test-notify.js --nickname <nick> --chatId <chatId> [--matchId <id>] [--port 8080] [--secret <secret>] [--force]');
    process.exit(1);
}
if (!API_KEY) {
    console.error('Error: FACEIT_API_KEY not set in environment / .env');
    process.exit(1);
}
if (FORCE && !BOT_TOKEN) {
    console.error('Error: --force requires TELEGRAM_BOT_TOKEN to be set in environment / .env');
    process.exit(1);
}

const WEBAPP_URL  = process.env.WEBAPP_URL || null;
const BOT_USERNAME = process.env.BOT_USERNAME || null;


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
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
    });
}

// ── POST to local bot ─────────────────────────────────────────────────────────
async function postWebhook(payload) {
    const body = JSON.stringify({ event: 'match_status_ready', payload });
    return new Promise((resolve, reject) => {
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
        };
        if (SECRET) headers['x-faceit-webhook-secret'] = SECRET;

        const req = http.request({
            hostname: 'localhost', port: PORT,
            path: '/webhook/faceit', method: 'POST', headers,
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

// ── Send Telegram photo directly (--force mode) ───────────────────────────────
async function sendTelegramPhoto(chatId, imageBuffer, replyMarkup, caption) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', imageBuffer, { filename: 'match.png', contentType: 'image/png' });
    if (caption) {
        form.append('caption', caption);
        form.append('parse_mode', 'HTML');
    }
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));

    return new Promise((resolve, reject) => {
        const formHeaders = form.getHeaders();
        const formBuffer  = form.getBuffer();
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendPhoto`,
            method: 'POST',
            headers: { ...formHeaders, 'Content-Length': formBuffer.length },
        }, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        });
        req.on('error', reject);
        req.write(formBuffer);
        req.end();
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
    console.log(`\n🔍 Looking up player "${NICKNAME}" on FACEIT...`);
    const player = await faceitGet(`/players?nickname=${encodeURIComponent(NICKNAME)}&game=cs2`);
    if (!player) { console.error('❌ Player not found'); process.exit(1); }

    const playerId = player.player_id;
    console.log(`✅ Found: ${player.nickname} (${playerId})`);

    let recentMatchId = MATCH_ID;
    if (recentMatchId) {
        console.log(`ℹ️  Using provided matchId: ${recentMatchId}`);
    } else {
        console.log('🔍 Fetching recent match history...');
        const statsResp = await faceitGet(`/players/${playerId}/games/cs2/stats?limit=1`);
        recentMatchId = statsResp?.items?.[0]?.stats?.['Match Id'];
        if (!recentMatchId) { console.error('❌ No recent matches found'); process.exit(1); }
        console.log(`✅ Most recent match: ${recentMatchId}`);
    }
    console.log('🔍 Fetching match details...');

    const match = await faceitGet(`/matches/${recentMatchId}`);
    if (!match) { console.error('❌ Match not found'); process.exit(1); }

    const f1 = match.teams?.faction1;
    const f2 = match.teams?.faction2;
    console.log(`✅ Match status: ${match.status}`);
    console.log(`   ${f1?.name} vs ${f2?.name}`);

    const webAppUrl = `http://localhost:${PORT}/app?matchId=${recentMatchId}&chatId=${CHAT_ID}`;

    if (FORCE) {
        // ── Force mode: send match image directly via Telegram API ───────────
        console.log(`\n📤 --force: sending match image to chat ${CHAT_ID} via Telegram API...`);

        const { generateMatchImage } = require('../src/services/imageService');

        const team1TrackedPlayers = f1?.roster
            ?.filter(p => p.nickname?.toLowerCase() === NICKNAME.toLowerCase())
            .map(p => p.nickname) ?? [];
        const team2TrackedPlayers = f2?.roster
            ?.filter(p => p.nickname?.toLowerCase() === NICKNAME.toLowerCase())
            .map(p => p.nickname) ?? [];

        const matchInfo = {
            team1: {
                name:           f1?.name || 'Faction 1',
                elo:            f1?.stats?.rating ?? null,
                winProb:        f1?.stats?.winProbability ?? null,
                trackedPlayers: team1TrackedPlayers,
            },
            team2: {
                name:           f2?.name || 'Faction 2',
                elo:            f2?.stats?.rating ?? null,
                winProb:        f2?.stats?.winProbability ?? null,
                trackedPlayers: team2TrackedPlayers,
            },
            competition: match.competition_name ?? null,
            region:      match.region ?? null,
            bestOf:      match.best_of ?? null,
        };

        const imageBuffer = await generateMatchImage(matchInfo);

        const boldNames = [NICKNAME].map(n => `<b>${n}</b>`);
        const caption   = boldNames.join(' и ') + ' начал матч';

        // Build inline keyboard — mirrors logic from subscriptionService.js
        let replyMarkup = null;
        if (WEBAPP_URL) {
            const isGroup = Number(CHAT_ID) < 0;
            let button = null;
            if (isGroup && BOT_USERNAME) {
                const startapp = encodeURIComponent(`${CHAT_ID}_${recentMatchId}`);
                button = { text: '📊 Составы и счёт', url: `https://t.me/${BOT_USERNAME}?startapp=${startapp}&mode=compact` };
            } else if (!isGroup) {
                button = { text: '📊 Составы и счёт', web_app: { url: `${WEBAPP_URL}?chatId=${CHAT_ID}&matchId=${recentMatchId}` } };
            }
            if (button) replyMarkup = { inline_keyboard: [[button]] };
        }
        if (!replyMarkup) {
            console.log('   ℹ️  No WEBAPP_URL set — button omitted.');
        }

        const result = await sendTelegramPhoto(CHAT_ID, imageBuffer, replyMarkup, caption);
        if (result.ok) {
            console.log(`✅ Match image sent to chat ${CHAT_ID}`);
        } else {
            console.error(`❌ Telegram error: ${result.description}`);
        }
    } else {
        // ── Normal mode: POST fake webhook to local server ───────────────────
        // Fix: FACEIT API uses match_id, but handleMatchEvent expects id
        const webhookPayload = { ...match, id: match.match_id || match.id };

        console.log(`\n📤 Sending fake webhook to http://localhost:${PORT}/webhook/faceit ...`);
        const result = await postWebhook(webhookPayload);

        if (result.status === 200) {
            console.log(`✅ Webhook accepted (HTTP ${result.status})`);
            console.log(`\n💬 Notification will arrive only if chat ${CHAT_ID} is subscribed to "${NICKNAME}".`);
            console.log(`   If not — run /subscribe ${NICKNAME} in the chat first, or use --force flag.`);
        } else {
            console.error(`❌ Webhook rejected (HTTP ${result.status}): ${result.body}`);
        }
    }

    console.log(`\n🌐 Web app: ${webAppUrl}`);
})().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
