const storageService = require('./storageService');
const { sendPhoto } = require('./telegramService');
const { getMatchDetails, getMatchStats, extractPlayerMatchStats, getPlayerDetails, getLastMatchEloChange } = require('./faceitService');
const { generateMatchImage, generateMatchResultsSummaryImage } = require('./imageService');
const { escapeHtml } = require('../utils');
const config = require('../config');
const { invalidate } = require('./statsCache');

/**
 * Handle a Telegram sendPhoto failure. If the bot was kicked from the chat or
 * blocked by the user (HTTP 403), clean up all Firestore data for that chat
 * and invalidate its stats cache — this is now a handled, expected condition.
 * Any other error is rethrown unchanged.
 * @param {string} chatId
 * @param {Error} error
 */
async function handleSendPhotoError(chatId, error) {
    if (error.response?.status !== 403) {
        throw error;
    }
    await storageService.deleteChatData(chatId);
    invalidate(`${chatId}:`);
    invalidate(`activity:${chatId}:`);
    console.log(`[FACEIT WEBHOOK] Bot was kicked/blocked in chat ${chatId} — deleted all related data.`);
}

/**
 * Handle an incoming FACEIT match_object_created webhook event.
 * Finds all subscribed chats for players in the match roster,
 * groups them, and sends one notification per chat (deduplication via Firestore).
 * @param {object} payload  The event payload from FACEIT
 */
async function handleMatchEvent(payload) {
    const matchId = payload?.id;
    if (!matchId) {
        console.warn('[FACEIT WEBHOOK] Received match event with no match ID');
        return;
    }

    // Extract team info and rosters
    let matchData = payload;
    let faction1 = payload?.teams?.faction1 || {};
    let faction2 = payload?.teams?.faction2 || {};
    let allRosterPlayers = [...(faction1.roster || []), ...(faction2.roster || [])];

    if (allRosterPlayers.length === 0) {
        console.warn(`[FACEIT WEBHOOK] Match ${matchId} has no roster data in payload, fetching from API...`);
        matchData = await getMatchDetails(config.faceit_api_key, matchId);
        faction1 = matchData?.teams?.faction1 || {};
        faction2 = matchData?.teams?.faction2 || {};
        allRosterPlayers = [...(faction1.roster || []), ...(faction2.roster || [])];

        if (allRosterPlayers.length === 0) {
            console.warn(`[FACEIT WEBHOOK] Match ${matchId} has no roster data in API response either, skipping`);
            return;
        }
    }

    const team1Name = faction1.name || 'Team 1';
    const team2Name = faction2.name || 'Team 2';
    const team1Elo = faction1.stats?.rating;
    const team2Elo = faction2.stats?.rating;
    const team1WinProb = faction1.stats?.winProbability;
    const team2WinProb = faction2.stats?.winProbability;

    const competitionName = matchData?.competition_name;
    const region = matchData?.region;
    const bestOf = matchData?.best_of;


    // For each player in the match, find which chats are subscribed
    const chatToPlayers = new Map(); // chatId → { nicknames: [], playerIds: [] }
    await Promise.all(allRosterPlayers.map(async (rosterPlayer) => {
        const playerId = rosterPlayer.player_id;
        const nickname = rosterPlayer.nickname;
        if (!playerId) return;

        const subscribedChats = await storageService.getSubscribedChats(playerId);
        for (const chatId of subscribedChats) {
            if (!chatToPlayers.has(chatId)) {
                chatToPlayers.set(chatId, { nicknames: [], playerIds: [] });
            }
            const entry = chatToPlayers.get(chatId);
            entry.nicknames.push(nickname);
            entry.playerIds.push(playerId);
        }
    }));

    if (chatToPlayers.size === 0) {
        console.log(`[FACEIT WEBHOOK] Match ${matchId}: no subscribed chats found`);
        return;
    }

    // Send one notification per chat, skipping already-sent ones (atomic via Firestore create())
    await Promise.all([...chatToPlayers.entries()].map(async ([chatId, { nicknames, playerIds }]) => {
        const created = await storageService.markNotificationSent(matchId, chatId, playerIds);
        if (!created) {
            console.log(`[FACEIT WEBHOOK] Match ${matchId} notification already sent to chat ${chatId}, skipping`);
            return;
        }

        await storageService.storeActiveMatch(chatId, matchId);

        const team1TrackedPlayers = nicknames.filter(n => faction1.roster?.some(p => p.nickname === n));
        const team2TrackedPlayers = nicknames.filter(n => faction2.roster?.some(p => p.nickname === n));

        // Roster avatars come straight from the FACEIT match roster (`p.avatar`) —
        // no extra API call needed (see enrichMatchWithRosterElos, which relies on
        // the same field for the web app).
        const team1Players = (faction1.roster || []).map(p => ({
            nickname: p.nickname,
            avatar_url: p.avatar || null,
            tracked: team1TrackedPlayers.includes(p.nickname),
        }));
        const team2Players = (faction2.roster || []).map(p => ({
            nickname: p.nickname,
            avatar_url: p.avatar || null,
            tracked: team2TrackedPlayers.includes(p.nickname),
        }));

        const matchInfo = {
            team1: { name: team1Name, elo: team1Elo, winProb: team1WinProb, trackedPlayers: team1TrackedPlayers, players: team1Players },
            team2: { name: team2Name, elo: team2Elo, winProb: team2WinProb, trackedPlayers: team2TrackedPlayers, players: team2Players },
            competition: competitionName,
            region,
            bestOf,
        };

        const imageBuffer = await generateMatchImage(matchInfo);

        // Caption: bold escaped nicknames, HTML parse mode
        const boldNames = nicknames.map(n => `<b>${escapeHtml(n)}</b>`);
        const verb      = nicknames.length === 1 ? 'начал матч' : 'начали матч';
        const caption   = boldNames.join(' и ') + ' ' + verb;

        // Build inline keyboard: Mini App button (web_app for private, t.me link for groups)
        const inlineButtons = [];
        if (config.webapp_url) {
            const isGroup = Number(chatId) < 0;
            if (isGroup && config.bot_username) {
                const startapp = encodeURIComponent(`${chatId}_${matchId}`);
                const directLink = `https://t.me/${config.bot_username}?startapp=${startapp}&mode=compact`;
                inlineButtons.push({ text: '📊 Составы и счёт', url: directLink });
            } else if (!isGroup) {
                const webAppUrl = `${config.webapp_url}?chatId=${chatId}&matchId=${matchId}`;
                inlineButtons.push({ text: '📊 Составы и счёт', web_app: { url: webAppUrl } });
            }
        }
        const replyMarkup = inlineButtons.length ? { inline_keyboard: [inlineButtons] } : null;

        let sentMessage;
        try {
            sentMessage = await sendPhoto(chatId, imageBuffer, caption, replyMarkup);
        } catch (error) {
            await handleSendPhotoError(chatId, error);
            return;
        }
        const telegramMessageId = sentMessage?.message_id ?? null;
        await storageService.storeActiveMatch(chatId, matchId, telegramMessageId);
        console.log(`[FACEIT WEBHOOK] Sent match ${matchId} image notification to chat ${chatId} for players: ${nicknames.join(', ')}`);
    }));
}

/**
 * Builds the Web App inline button for a chat, same logic as match-start notifications.
 */
function buildWebAppButton(chatId, matchId) {
    if (!config.webapp_url) return null;
    const isGroup = Number(chatId) < 0;
    if (isGroup && config.bot_username) {
        const startapp = encodeURIComponent(`${chatId}_${matchId}`);
        return { text: '📊 Составы и счёт', url: `https://t.me/${config.bot_username}?startapp=${startapp}&mode=compact` };
    }
    if (!isGroup) {
        return { text: '📊 Составы и счёт', web_app: { url: `${config.webapp_url}?chatId=${chatId}&matchId=${matchId}` } };
    }
    return null;
}

/**
 * Handle an incoming FACEIT match_status_finished webhook event.
 * For each subscribed chat, sends the finish results as a new message that
 * replies to the original start notification (when its message_id is known).
 * Falls back to sending a plain (non-reply) message if the original message_id
 * is not available.
 * @param {object} payload  The event payload from FACEIT
 */
async function handleMatchFinishedEvent(payload) {
    const matchId = payload?.id;
    if (!matchId) {
        console.warn('[FACEIT WEBHOOK] Received finish event with no match ID');
        return;
    }

    // Extract roster (same fallback pattern as handleMatchEvent)
    let matchData        = payload;
    let faction1         = payload?.teams?.faction1 || {};
    let faction2         = payload?.teams?.faction2 || {};
    let allRosterPlayers = [...(faction1.roster || []), ...(faction2.roster || [])];

    if (allRosterPlayers.length === 0) {
        console.warn(`[FACEIT WEBHOOK] Finish: match ${matchId} has no roster in payload, fetching from API...`);
        matchData        = await getMatchDetails(config.faceit_api_key, matchId);
        faction1         = matchData?.teams?.faction1 || {};
        faction2         = matchData?.teams?.faction2 || {};
        allRosterPlayers = [...(faction1.roster || []), ...(faction2.roster || [])];

        if (allRosterPlayers.length === 0) {
            console.warn(`[FACEIT WEBHOOK] Finish: match ${matchId} has no roster from API either, skipping`);
            return;
        }
    }

    const competitionName = matchData?.competition_name ?? null;

    // Find which chats are subscribed and which players are in each chat
    const chatToPlayers = new Map(); // chatId → Map<playerId, { playerId, nickname }>
    await Promise.all(allRosterPlayers.map(async (rosterPlayer) => {
        const playerId = rosterPlayer.player_id;
        const nickname = rosterPlayer.nickname;
        if (!playerId) return;

        const subscribedChats = await storageService.getSubscribedChats(playerId);
        for (const chatId of subscribedChats) {
            if (!chatToPlayers.has(chatId)) chatToPlayers.set(chatId, new Map());
            const playersMap = chatToPlayers.get(chatId);
            if (!playersMap.has(playerId)) {
                playersMap.set(playerId, { playerId, nickname });
            }
        }
    }));

    if (chatToPlayers.size === 0) {
        console.log(`[FACEIT WEBHOOK] Finish: match ${matchId} — no subscribed chats`);
        return;
    }

    // Fetch match stats once — needed for all players
    const matchStats = await getMatchStats(config.faceit_api_key, matchId);
    if (!matchStats) {
        console.warn(`[FACEIT WEBHOOK] Finish: match ${matchId} has no stats (cancelled/walkover?), skipping`);
        return;
    }

    await Promise.all([...chatToPlayers.entries()].map(async ([chatId, playersMap]) => {
        const players = [...playersMap.values()];

        // Read message_id BEFORE removing the active match record — otherwise the
        // document will be gone by the time we call getActiveMatchMessageId later.
        const startMessageId = await storageService.getActiveMatchMessageId(chatId, matchId);

        // Clean up active match record for this chat (fire-and-forget, safe now)
        storageService.removeActiveMatch(chatId, matchId).catch(() => {});

        // Atomic create: returns false if already sent (race condition protection)
        const created = await storageService.markFinishNotificationSentForChat(matchId, chatId, players.map(p => p.playerId));
        if (!created) {
            console.log(`[FACEIT WEBHOOK] Finish notification for match ${matchId} already sent to chat ${chatId}, skipping`);
            return;
        }

        // Fetch current ELO + details for all tracked players in parallel
        const playerDetails = await Promise.all(players.map(async ({ playerId, nickname }) => {
            const details = await getPlayerDetails(config.faceit_api_key, playerId).catch(() => null);
            const eloChange = await getLastMatchEloChange(playerId).catch(() => null);
            return {
                playerId,
                nickname: details?.nickname ?? nickname,
                currentElo:  details?.elo        ?? null,
                skillLevel:  details?.skillLevel  ?? null,
                avatar_url:  details?.avatar      ?? null,
                eloChange,
            };
        }));

        const cardPlayersData = playerDetails.map((player) => {
            const stats = extractPlayerMatchStats(matchStats, player.playerId) || {};
            return {
                nickname: player.nickname,
                avatar_url: player.avatar_url,
                skillLevel: player.skillLevel,
                currentElo: player.currentElo,
                eloChange: player.eloChange,
                competition: competitionName,
                kills: stats.kills ?? 0,
                deaths: stats.deaths ?? 0,
                assists: stats.assists ?? 0,
                kd: stats.kd ?? 0,
                adr: stats.adr ?? 0,
                hsPercent: stats.hsPercent ?? 0,
                result: stats.result ?? null,
                map: stats.map ?? null,
                teamScore: stats.teamScore ?? null,
                opponentScore: stats.opponentScore ?? null,
            };
        });

        const button      = buildWebAppButton(chatId, matchId);
        const replyMarkup = button ? { inline_keyboard: [[button]] } : null;

        const imageBuffer = await generateMatchResultsSummaryImage(cardPlayersData);

        // Build a simple caption: "X и Y завершили матч"
        const boldNames = players.map(p => `<b>${escapeHtml(p.nickname)}</b>`);
        const verb = players.length === 1 ? 'завершил матч' : 'завершили матч';
        const caption = boldNames.join(' и ') + ' ' + verb;

        // Send a reply to the original start notification when its message_id is
        // known; otherwise fall back to a plain (non-reply) message.
        try {
            await sendPhoto(chatId, imageBuffer, caption, replyMarkup, startMessageId || null);
        } catch (error) {
            await handleSendPhotoError(chatId, error);
            return;
        }
        console.log(`[FACEIT WEBHOOK] Finish: sent aggregated notification for match ${matchId} to chat ${chatId} (players: ${players.map(p => p.nickname).join(', ')})`);
    }));
}


module.exports = { handleMatchEvent, handleMatchFinishedEvent };
