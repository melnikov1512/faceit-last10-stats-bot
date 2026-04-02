const storageService = require('./storageService');
const { sendPhoto } = require('./telegramService');
const { getMatchDetails } = require('./faceitService');
const { generateMatchImage } = require('./imageService');
const config = require('../config');

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

module.exports = { handleMatchEvent };
