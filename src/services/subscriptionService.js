const storageService = require('./storageService');
const { sendPhoto } = require('./telegramService');
const { getMatchDetails, getMatchStats, extractPlayerMatchStats, getPlayerDetails, getLastMatchEloChange } = require('./faceitService');
const { generateMatchImage, generateMatchResultImage } = require('./imageService');
const { getRandomFunnyMessage, getExamplePlayersText } = require('../data/matchFinishMessages');
const { escapeHtml } = require('../utils');
const config = require('../config');

const ELO_THRESHOLD = 2000;

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

    // Send one notification per chat, skipping already-sent ones
    await Promise.all([...chatToPlayers.entries()].map(async ([chatId, { nicknames, playerIds }]) => {
        const alreadySent = await storageService.hasNotificationBeenSent(matchId, chatId);
        if (alreadySent) {
            console.log(`[FACEIT WEBHOOK] Match ${matchId} notification already sent to chat ${chatId}, skipping`);
            return;
        }

        await storageService.markNotificationSent(matchId, chatId, playerIds);
        await storageService.storeActiveMatch(chatId, matchId);

        const team1TrackedPlayers = nicknames.filter(n => faction1.roster?.some(p => p.nickname === n));
        const team2TrackedPlayers = nicknames.filter(n => faction2.roster?.some(p => p.nickname === n));

        const matchInfo = {
            team1: { name: team1Name, elo: team1Elo, winProb: team1WinProb, trackedPlayers: team1TrackedPlayers },
            team2: { name: team2Name, elo: team2Elo, winProb: team2WinProb, trackedPlayers: team2TrackedPlayers },
            competition: competitionName,
            region,
            bestOf,
        };

        const imageBuffer = await generateMatchImage(matchInfo);

        // Caption: bold nicknames, no icons, HTML parse mode
        const boldNames = nicknames.map(n => `<b>${n}</b>`);
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

        await sendPhoto(chatId, imageBuffer, caption, replyMarkup);
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
 * For each subscribed chat, sends a per-player result card + funny message
 * for every tracked player whose current ELO is below the threshold (2000).
 * If any tracked player in the match is ≥2000 ELO, appends a "take example" line.
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
    const chatToPlayers = new Map(); // chatId → [{ playerId, nickname }]
    await Promise.all(allRosterPlayers.map(async (rosterPlayer) => {
        const playerId = rosterPlayer.player_id;
        const nickname = rosterPlayer.nickname;
        if (!playerId) return;

        const subscribedChats = await storageService.getSubscribedChats(playerId);
        for (const chatId of subscribedChats) {
            if (!chatToPlayers.has(chatId)) chatToPlayers.set(chatId, []);
            chatToPlayers.get(chatId).push({ playerId, nickname });
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

    await Promise.all([...chatToPlayers.entries()].map(async ([chatId, players]) => {
        // Clean up active match record for this chat
        storageService.removeActiveMatch(chatId, matchId).catch(() => {});

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

        const belowThreshold = playerDetails.filter(p => p.currentElo != null && p.currentElo < ELO_THRESHOLD);
        const aboveThreshold = playerDetails.filter(p => p.currentElo != null && p.currentElo >= ELO_THRESHOLD);

        if (belowThreshold.length === 0) {
            console.log(`[FACEIT WEBHOOK] Finish: match ${matchId} chat ${chatId} — no players below ${ELO_THRESHOLD} ELO`);
            return;
        }

        const button      = buildWebAppButton(chatId, matchId);
        const replyMarkup = button ? { inline_keyboard: [[button]] } : null;
        const exampleText = aboveThreshold.length > 0
            ? getExamplePlayersText(aboveThreshold.map(p => p.nickname))
            : null;

        await Promise.all(belowThreshold.map(async (player) => {
            const alreadySent = await storageService.hasFinishNotificationBeenSent(matchId, chatId, player.playerId);
            if (alreadySent) {
                console.log(`[FACEIT WEBHOOK] Finish notification for ${player.nickname} in chat ${chatId} already sent, skipping`);
                return;
            }

            const playerMatchStats = extractPlayerMatchStats(matchStats, player.playerId);
            if (!playerMatchStats) {
                console.warn(`[FACEIT WEBHOOK] Finish: no stats for player ${player.nickname} in match ${matchId}`);
                return;
            }

            await storageService.markFinishNotificationSent(matchId, chatId, player.playerId);

            const imageBuffer = await generateMatchResultImage({
                nickname:    player.nickname,
                avatar_url:  player.avatar_url,
                skillLevel:  player.skillLevel,
                currentElo:  player.currentElo,
                eloChange:   player.eloChange,
                competition: competitionName,
                ...playerMatchStats,
            });

            const funnyMessage = getRandomFunnyMessage(player.nickname, player.currentElo);
            const caption = exampleText
                ? `${escapeHtml(funnyMessage)}\n\n${escapeHtml(exampleText)}`
                : escapeHtml(funnyMessage);

            await sendPhoto(chatId, imageBuffer, caption, replyMarkup);
            console.log(`[FACEIT WEBHOOK] Finish: sent result card for ${player.nickname} (${player.currentElo} ELO) to chat ${chatId}`);
        }));
    }));
}

