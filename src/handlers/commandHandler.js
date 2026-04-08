const { getLeaderboardStats, getPlayerDetailsByNickname, getPlayerDetails } = require('../services/faceitService');
const { collectMatchIds, fetchActiveMatchDetails } = require('../services/matchService');
const { MATCH_STATUS_LABELS } = require('../constants');
const { escapeHtml } = require('../utils');
const config = require('../config');
const storageService = require('../services/storageService');
const { COMMANDS, COMMAND_LIST } = require('../commands');
const { generateStatsImage, generatePlayerCard, generatePlayersListImage } = require('../services/imageService');
const { sendPhoto } = require('../services/telegramService');

function forceReply(commandKey) {
    const cmd = COMMAND_LIST.find(c => c.key === commandKey);
    return { type: 'force_reply', prompt: cmd.prompt, placeholder: cmd.placeholder };
}

async function handleStats(chatId, args, apiKey) {
    const players = await storageService.getPlayers(chatId);

    if (players.length === 0) {
        return `⚠️ No players tracked in this chat. Use <code>${COMMANDS.ADD_PLAYER} &lt;nickname&gt;</code> to start.`;
    }

    let matchesCount = config.last_matches || 10;
    if (args.length > 0) {
        const parsedCount = parseInt(args[0], 10);
        if (!isNaN(parsedCount) && parsedCount >= 2 && parsedCount <= 100) {
            matchesCount = parsedCount;
        }
    }

    const leaderboard = await getLeaderboardStats(apiKey, players, matchesCount);

    if (!leaderboard || leaderboard.length === 0) {
        return 'Failed to retrieve stats for any player.';
    }

    const imageBuffer = await generateStatsImage(leaderboard, matchesCount);
    await sendPhoto(chatId, imageBuffer);

    // Return null — photo already sent via direct API call; webhook reply not needed
    return null;
}

async function handlePlayers(chatId, apiKey) {
    const players = await storageService.getPlayers(chatId);
    if (players.length === 0) {
        return `⚠️ No players tracked in this chat. Use <code>${COMMANDS.ADD_PLAYER} &lt;nickname&gt;</code> to start.`;
    }

    const details = await Promise.all(
        players.map(p => getPlayerDetails(apiKey, p.id).catch(() => ({
            playerId: p.id, nickname: p.nickname, avatar: null, elo: null, skillLevel: null,
        })))
    );

    // Sort by ELO descending; players without ELO go to the end
    details.sort((a, b) => (b.elo ?? -1) - (a.elo ?? -1));

    const imageBuffer = await generatePlayersListImage(details);
    const lines = details.map((p, i) =>
        `${i + 1}. <b>${escapeHtml(p.nickname ?? '—')}</b>${p.elo != null ? ` — ${p.elo} ELO` : ''}`
    );
    const caption = `<b>Отслеживаемые игроки:</b>\n${lines.join('\n')}`;
    await sendPhoto(chatId, imageBuffer, caption);
    return null;
}

async function handleAddPlayer(chatId, args, apiKey, chatName) {
    if (args.length === 0) {
        return forceReply('ADD_PLAYER');
    }

    const player = await getPlayerDetailsByNickname(apiKey, args[0]);
    if (!player) {
        return `❌ Player <b>${escapeHtml(args[0])}</b> not found on FACEIT.`;
    }

    await storageService.addPlayer(chatId, { id: player.playerId, nickname: player.nickname }, chatName);
    await storageService.subscribeChat(chatId, player.playerId, player.nickname);

    console.log(`[ADD_PLAYER] Chat ${chatId} added and subscribed to "${player.nickname}" (${player.playerId})`);

    const imageBuffer = await generatePlayerCard(player, 'added');
    const caption = `Игрок <b>${escapeHtml(player.nickname)}</b> добавлен в список отслеживания.`;
    await sendPhoto(chatId, imageBuffer, caption);
    return null;
}

async function handleRemovePlayer(chatId, args, apiKey) {
    if (args.length === 0) {
        return forceReply('REMOVE_PLAYER');
    }

    const players = await storageService.getPlayers(chatId);
    const inputNickname = args[0].toLowerCase();
    const player = players.find(p => p.nickname?.toLowerCase() === inputNickname);

    if (!player) {
        return `❌ Player <b>${escapeHtml(args[0])}</b> is not in the tracking list.`;
    }

    await storageService.removePlayer(chatId, player.id);
    await storageService.unsubscribeChat(chatId, player.id);

    const details = await getPlayerDetails(apiKey, player.id).catch(() => ({
        playerId: player.id, nickname: player.nickname, avatar: null, elo: null, skillLevel: null,
    }));

    const imageBuffer = await generatePlayerCard(details, 'removed');
    const caption = `Игрок <b>${escapeHtml(details.nickname ?? args[0])}</b> удалён из списка отслеживания.`;
    await sendPhoto(chatId, imageBuffer, caption);
    return null;
}

function handleHelp() {
    const lines = COMMAND_LIST.map(c => {
        const usage = c.args
            ? `<code>${c.command} ${escapeHtml(c.args)}</code>`
            : `<code>${c.command}</code>`;
        return `• ${usage} — ${c.description}`;
    });
    return `🤖 <b>Команды бота:</b>\n\n` + lines.join('\n');
}

async function handleLive(chatId) {
    const url = config.webapp_url;
    if (!url) {
        return '⚠️ Web app не настроен. Установите переменную окружения <code>WEBAPP_URL</code>.';
    }

    let matchListText = '';
    try {
        const subscriptions = await storageService.getChatSubscriptions(chatId);
        if (subscriptions.length) {
            const trackedPlayerIds = new Set(subscriptions.map(s => s.playerId));
            const allIds = await collectMatchIds(chatId, [...trackedPlayerIds]);

            if (allIds.length) {
                const active = await fetchActiveMatchDetails(chatId, allIds, config.faceit_api_key);
                if (active.length) {
                    const lines = active.map(({ match: m }) => {
                        const label = MATCH_STATUS_LABELS[m.status] || m.status;
                        const f1 = m.teams?.faction1?.name || '?';
                        const f2 = m.teams?.faction2?.name || '?';
                        return `${label}  <b>${escapeHtml(f1)}</b> vs <b>${escapeHtml(f2)}</b>`;
                    });
                    matchListText = '\n\n' + lines.join('\n');
                } else {
                    matchListText = '\n\n<i>Нет активных матчей</i>';
                }
            } else {
                matchListText = '\n\n<i>Нет активных матчей</i>';
            }
        }
    } catch (e) {
        // non-critical — just omit the list
        console.warn('[handleLive] Failed to fetch active matches for caption:', e.message);
    }

    return {
        type: 'web_app',
        text: `🎮 Активные матчи подписанных игроков${matchListText}`,
        url: `${url}?chatId=${chatId}`,
        parse_mode: 'HTML',
    };
}

async function handleCommand(command, chatId, args, apiKey, chatName) {
    switch (command) {
        case COMMANDS.STATS:
            return handleStats(chatId, args, apiKey);
        case COMMANDS.ADD_PLAYER:
            return handleAddPlayer(chatId, args, apiKey, chatName);
        case COMMANDS.REMOVE_PLAYER:
            return handleRemovePlayer(chatId, args, apiKey);
        case COMMANDS.PLAYERS:
            return handlePlayers(chatId, apiKey);
        case COMMANDS.LIVE:
            return handleLive(chatId);
        case COMMANDS.HELP:
            return handleHelp();
        default:
            return null;
    }
}

module.exports = {
    handleCommand
};