#!/usr/bin/env node
/**
 * Test script: simulate a FACEIT match_status_finished webhook for local testing.
 *
 * Usage:
 *   npm run test-notify-finish -- --nickname <faceit_nickname> --chatId <telegram_chat_id> [options]
 *
 * Options:
 *   --port    <port>    Local server port (default: 8080)
 *   --secret  <secret>  FACEIT webhook secret (or set FACEIT_WEBHOOK_SECRET env var)
 *   --matchId <id>      Use a specific finished match ID instead of fetching the player's latest
 *   --force             Skip subscription check — run finish handler directly and send via Telegram API
 *
 * Normal mode: POSTs a fake match_status_finished to http://localhost:<port>/webhook/faceit.
 *   The chat must be subscribed to the player for the notification to arrive.
 *   The player must have ELO < 2000 after the match.
 *
 * --force mode: Bypasses subscription checks. Fetches match stats, generates the result image,
 *   and sends it directly to chatId via Telegram API.
 *   Use this for quick UI iteration without needing Firestore subscriptions.
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
const WEBAPP_URL    = process.env.WEBAPP_URL || null;
const BOT_USERNAME  = process.env.BOT_USERNAME || null;

if (!NICKNAME || !CHAT_ID) {
    console.error('Usage: npm run test-notify-finish -- --nickname <nick> --chatId <chatId> [--matchId <id>] [--port 8080] [--secret <secret>] [--force]');
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

// ── FACEIT API helpers ────────────────────────────────────────────────────────
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

// ── POST fake webhook to local server ─────────────────────────────────────────
async function postWebhook(payload) {
    const body = JSON.stringify({ event: 'match_status_finished', payload });
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
async function sendTelegramPhoto(chatId, imageBuffer, caption, replyMarkup) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', imageBuffer, { filename: 'result.png', contentType: 'image/png' });
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
    const currentElo = player.games?.cs2?.faceit_elo ?? null;
    const skillLevel = player.games?.cs2?.skill_level ?? null;
    console.log(`✅ Found: ${player.nickname} (${playerId}) — ELO: ${currentElo ?? '?'}`);

    if (currentElo !== null && currentElo >= 2000 && !FORCE) {
        console.warn(`⚠️  ${NICKNAME} has ${currentElo} ELO (≥ 2000). Finish notifications only fire for players below 2000 ELO.`);
        console.warn('   Use --force to send the image anyway, ignoring the ELO check.');
    }

    // Find a finished match
    let matchId = MATCH_ID;
    let match;

    if (matchId) {
        console.log(`ℹ️  Using provided matchId: ${matchId}`);
        match = await faceitGet(`/matches/${matchId}`);
        if (!match) { console.error('❌ Match not found'); process.exit(1); }
    } else {
        console.log('🔍 Fetching recent match history (looking for a FINISHED match)...');
        const statsResp = await faceitGet(`/players/${playerId}/games/cs2/stats?limit=5`);
        const items = statsResp?.items || [];
        matchId = items[0]?.stats?.['Match Id'];
        if (!matchId) { console.error('❌ No recent matches found'); process.exit(1); }
        match = await faceitGet(`/matches/${matchId}`);
        if (!match) { console.error('❌ Match details not found'); process.exit(1); }
        console.log(`✅ Using most recent match: ${matchId} (status: ${match.status})`);
    }

    const f1 = match.teams?.faction1;
    const f2 = match.teams?.faction2;
    console.log(`   ${f1?.name} vs ${f2?.name}`);

    if (FORCE) {
        // ── Force mode: generate result image and send directly ───────────────
        console.log('\n🔍 Fetching match stats...');
        const matchStats = await faceitGet(`/matches/${matchId}/stats`);
        if (!matchStats) {
            console.error('❌ Match stats not available (match may still be ongoing or was cancelled)');
            process.exit(1);
        }

        // Extract this player's stats
        const { extractPlayerMatchStats, getLastMatchEloChange } = require('../src/services/faceitService');
        const playerMatchStats = extractPlayerMatchStats(matchStats, playerId);
        if (!playerMatchStats) {
            console.error(`❌ Could not find stats for player ${NICKNAME} in match stats`);
            process.exit(1);
        }
        console.log(`✅ Player stats: Kills=${playerMatchStats.kills} Deaths=${playerMatchStats.deaths} ADR=${playerMatchStats.adr} Result=${playerMatchStats.result === 1 ? 'WIN' : 'LOSE'}`);

        console.log('🔍 Fetching ELO change for last match...');
        const eloChange = await getLastMatchEloChange(playerId).catch(() => null);
        console.log(`   ELO change: ${eloChange != null ? (eloChange >= 0 ? '+' : '') + eloChange : 'N/A'}`);

        const { generateMatchResultImage } = require('../src/services/imageService');
        const { getRandomFunnyMessage } = require('../src/data/matchFinishMessages');

        console.log('\n🎨 Generating match result image...');
        const imageBuffer = await generateMatchResultImage({
            nickname:    player.nickname,
            avatar_url:  player.avatar || null,
            skillLevel,
            currentElo,
            eloChange,
            competition: match.competition_name ?? null,
            ...playerMatchStats,
        });

        const funnyMessage = getRandomFunnyMessage(player.nickname, currentElo ?? 1999);
        console.log(`\n💬 Message:\n${funnyMessage}`);

        // Build Web App button
        let replyMarkup = null;
        if (WEBAPP_URL) {
            const isGroup = Number(CHAT_ID) < 0;
            let button = null;
            if (isGroup && BOT_USERNAME) {
                const startapp = encodeURIComponent(`${CHAT_ID}_${matchId}`);
                button = { text: '📊 Составы и счёт', url: `https://t.me/${BOT_USERNAME}?startapp=${startapp}&mode=compact` };
            } else if (!isGroup) {
                button = { text: '📊 Составы и счёт', web_app: { url: `${WEBAPP_URL}?chatId=${CHAT_ID}&matchId=${matchId}` } };
            }
            if (button) replyMarkup = { inline_keyboard: [[button]] };
        } else {
            console.log('   ℹ️  No WEBAPP_URL set — button omitted.');
        }

        console.log(`\n📤 Sending to chat ${CHAT_ID} via Telegram API...`);

        // Escape HTML for caption
        const escapeHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const caption = escapeHtml(funnyMessage);

        const result = await sendTelegramPhoto(CHAT_ID, imageBuffer, caption, replyMarkup);
        if (result.ok) {
            console.log(`✅ Result card sent to chat ${CHAT_ID}`);
        } else {
            console.error(`❌ Telegram error: ${result.description}`);
        }
    } else {
        // ── Normal mode: POST fake webhook to local server ────────────────────
        const webhookPayload = { ...match, id: match.match_id || match.id };

        console.log(`\n📤 Sending fake match_status_finished webhook to http://localhost:${PORT}/webhook/faceit ...`);
        const result = await postWebhook(webhookPayload);

        if (result.status === 200) {
            console.log(`✅ Webhook accepted (HTTP ${result.status})`);
            console.log(`\n💬 Notification will arrive if:`);
            console.log(`   1. Chat ${CHAT_ID} is subscribed to "${NICKNAME}" (use /add_player ${NICKNAME} in the chat)`);
            console.log(`   2. ${NICKNAME} has ELO < 2000 after the match`);
            console.log(`\n   Tip: use --force to bypass subscription check and send directly.`);
        } else {
            console.error(`❌ Webhook rejected (HTTP ${result.status}): ${result.body}`);
        }
    }
})().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
