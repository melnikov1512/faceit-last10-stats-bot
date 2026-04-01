const storageService = require('./storageService');
const { sendMessage } = require('./telegramService');
const { getPlayerIdByNickname, getMatchDetails } = require('./faceitService');
const config = require('../config');

const MATCH_URL_BASE = 'https://www.faceit.com/en/cs2/room';

/**
 * Subscribe a chat to match-start notifications for a player.
 * Resolves nickname → FACEIT playerId and stores in Firestore.
 * Logs the playerId so the admin can add the player to the FACEIT App Studio webhook subscription.
 * @param {string} chatId
 * @param {string} nickname
 * @param {string} apiKey
 * @returns {Promise<string>} Response message for the user
 */
async function subscribePlayerToChat(chatId, nickname, apiKey) {
    const playerData = await getPlayerIdByNickname(apiKey, nickname);
    if (!playerData) {
        return `❌ Player *${nickname}* not found on FACEIT.`;
    }

    const { playerId, nickname: resolvedNickname } = playerData;
    await storageService.subscribeChat(chatId, playerId, resolvedNickname);

    console.log(`[SUBSCRIPTION] Chat ${chatId} subscribed to player "${resolvedNickname}" (playerId: ${playerId}). Add this playerId to FACEIT App Studio webhook if not already present.`);

    return `✅ Subscribed to *${resolvedNickname}*'s matches.\n\n⚙️ _Admin note: ensure player ID \`${playerId}\` is added to the FACEIT webhook subscription in App Studio._`;
}

/**
 * Unsubscribe a chat from match-start notifications for a player.
 * @param {string} chatId
 * @param {string} nickname
 * @param {string} apiKey
 * @returns {Promise<string>} Response message for the user
 */
async function unsubscribePlayerFromChat(chatId, nickname, apiKey) {
    const playerData = await getPlayerIdByNickname(apiKey, nickname);
    if (!playerData) {
        return `❌ Player *${nickname}* not found on FACEIT.`;
    }

    const { playerId, nickname: resolvedNickname } = playerData;
    await storageService.unsubscribeChat(chatId, playerId);

    return `🔕 Unsubscribed from *${resolvedNickname}*'s matches.`;
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

    // Send one notification per chat, skipping already-sent ones
    await Promise.all([...chatToPlayers.entries()].map(async ([chatId, { nicknames, playerIds }]) => {
        const alreadySent = await storageService.hasNotificationBeenSent(matchId, chatId);
        if (alreadySent) {
            console.log(`[FACEIT WEBHOOK] Match ${matchId} notification already sent to chat ${chatId}, skipping`);
            return;
        }

        await storageService.markNotificationSent(matchId, chatId, playerIds);
        await storageService.storeActiveMatch(chatId, matchId);

        const playerList = nicknames.map(n => `*${n}*`).join(', ');
        const verb = nicknames.length === 1 ? 'начал' : 'начали';

        const metaParts = [
            competitionName,
            region,
            bestOf ? `BO${bestOf}` : null,
        ].filter(Boolean);

        const team1TrackedPlayers = nicknames.filter(n => faction1.roster?.some(p => p.nickname === n));
        const team2TrackedPlayers = nicknames.filter(n => faction2.roster?.some(p => p.nickname === n));

        // 🟠 for team with tracked player (FACEIT orange), ⬛ for opponent
        const team1HasTracked = team1TrackedPlayers.length > 0;
        const team2HasTracked = team2TrackedPlayers.length > 0;

        const formatTeamLine = (name, elo, winProb, trackedPlayers, hasTracked) => {
            const teamEmoji = hasTracked ? '🟠' : '⬛';
            const eloPart = elo ? `${elo} ELO` : null;
            const winPart = winProb != null ? `${Math.round(winProb * 100)}%` : null;
            const playerPart = trackedPlayers?.length > 0
                ? `⭐ ${trackedPlayers.map(n => `*${n}*`).join(', ')}`
                : null;
            return [teamEmoji, `*${name}*`, [eloPart, winPart].filter(Boolean).join(' · '), playerPart]
                .filter(Boolean).join('  ');
        };

        const lines = [
            `⚡️ ${playerList} ${verb} матч!`,
            ...(metaParts.length ? [`🏆 ${metaParts.join(' · ')}`] : []),
            '',
            formatTeamLine(team1Name, team1Elo, team1WinProb, team1TrackedPlayers, team1HasTracked),
            formatTeamLine(team2Name, team2Elo, team2WinProb, team2TrackedPlayers, team2HasTracked),
            '',
            `🎮 [Открыть матч](${MATCH_URL_BASE}/${matchId})`,
        ];
        const text = lines.join('\n');

        // Build inline keyboard: Mini App button (web_app for private, t.me link for groups)
        const inlineButtons = [];
        if (config.webapp_url) {
            const isGroup = Number(chatId) < 0;
            if (isGroup && config.bot_username) {
                // Groups don't support web_app inline buttons — use t.me direct link
                // Encode chatId and matchId in startapp: "chatId_matchId"
                const startapp = encodeURIComponent(`${chatId}_${matchId}`);
                const directLink = `https://t.me/${config.bot_username}?startapp=${startapp}&mode=compact`;
                inlineButtons.push({ text: '📊 Составы и счёт', url: directLink });
            } else if (!isGroup) {
                // Private chats support web_app inline buttons
                const webAppUrl = `${config.webapp_url}?chatId=${chatId}&matchId=${matchId}`;
                inlineButtons.push({ text: '📊 Составы и счёт', web_app: { url: webAppUrl } });
            }
        }
        const replyMarkup = inlineButtons.length
            ? { inline_keyboard: [inlineButtons] }
            : null;

        await sendMessage(chatId, text, replyMarkup);
        console.log(`[FACEIT WEBHOOK] Sent match ${matchId} notification to chat ${chatId} for players: ${nicknames.join(', ')}`);
    }));
}

module.exports = {
    subscribePlayerToChat,
    unsubscribePlayerFromChat,
    handleMatchEvent
};
