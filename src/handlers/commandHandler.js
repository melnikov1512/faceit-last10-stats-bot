const { getLeaderboardStats, getPlayerIdByNickname } = require('../services/faceitService');
const { collectMatchIds, fetchActiveMatchDetails } = require('../services/matchService');
const { MATCH_STATUS_LABELS } = require('../constants');
const { escapeHtml } = require('../utils');
const config = require('../config');
const storageService = require('../services/storageService');
const { subscribePlayerToChat, unsubscribePlayerFromChat } = require('../services/subscriptionService');
const { COMMANDS, COMMAND_LIST } = require('../commands');

function forceReply(commandKey) {
    const cmd = COMMAND_LIST.find(c => c.key === commandKey);
    return { type: 'force_reply', prompt: cmd.prompt, placeholder: cmd.placeholder };
}

function formatStatsMessage(leaderboard, requestedMatchesCount) {
    if (!leaderboard || leaderboard.length === 0) {
        return 'Failed to retrieve stats for any player.';
    }

    // Separator: single "|" (no spaces) — saves 2 chars per column vs " | "
    //
    // Fixed columns (each 4 chars) + 5 separators:
    //   ADR(4) | K/D(4) | Kill(4) | ELO(4) | ±ELO(4)  +  5×| = 25 chars
    //
    // Target row width: 40 chars  →  Name gets 40 − 25 = 15 chars max.
    // nameColWidth is dynamic: capped at min(longestName, 15) so short-name
    // lists produce even narrower rows.

    const COL = 4;           // every data column is exactly 4 chars
    const SEP = '|';         // single-char separator
    const NUM_SEPS = 5;      // separators between 6 columns
    const MAX_WIDTH = 40;
    const FIXED = NUM_SEPS + COL * 5; // 5 + 20 = 25

    const longestName  = leaderboard.reduce((max, p) => Math.max(max, p.nickname.length), 0);
    const nameW = Math.max(4, Math.min(longestName, MAX_WIDTH - FIXED)); // max 15

    const titleCount = requestedMatchesCount || leaderboard[0].matchesAnalyzed || 10;
    let table = '';

    // ── header ──────────────────────────────────────────────
    const h = (s) => s.padStart(COL);
    table += `${'Name'.padEnd(nameW)}${SEP}${h('ADR')}${SEP}${h('K/D')}${SEP}${h('Kill')}${SEP}${h('ELO')}${SEP}${h('±ELO')}\n`;
    const dash = '-'.repeat(COL);
    table += `${'-'.repeat(nameW)}${SEP}${dash}${SEP}${dash}${SEP}${dash}${SEP}${dash}${SEP}${dash}\n`;

    // ── rows ─────────────────────────────────────────────────
    leaderboard.forEach(player => {
        let name = player.nickname;
        if (name.length > nameW) name = name.substring(0, nameW);
        name = name.padEnd(nameW);

        const adr  = parseFloat(player.average_damage_per_round).toFixed(1).padStart(COL);
        const kd   = player.kills_deaths_ratio.toString().padStart(COL);
        const kill = parseFloat(player.average_kills).toFixed(1).padStart(COL);
        const elo  = player.current_elo != null
            ? player.current_elo.toString().padStart(COL)
            : ' N/A';
        const chg  = player.elo_change != null
            ? `${player.elo_change >= 0 ? '+' : ''}${player.elo_change}`.padStart(COL)
            : ' N/A';

        table += `${escapeHtml(name)}${SEP}${adr}${SEP}${kd}${SEP}${kill}${SEP}${elo}${SEP}${chg}\n`;
    });

    return `<b>📊 FACEIT Last ${titleCount} Matches Stats</b>\n\n<pre>${table}</pre>`;
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
    return formatStatsMessage(leaderboard, matchesCount);
}

async function handlePlayers(chatId) {
    const players = await storageService.getPlayers(chatId);
    if (players.length === 0) {
        return `⚠️ No players tracked in this chat. Use <code>${COMMANDS.ADD_PLAYER} &lt;nickname&gt;</code> to start.`;
    }
    return `📋 <b>Tracked Players:</b>\n\n` + players.map(p => `• <code>${escapeHtml(p.nickname)}</code>`).join('\n');
}

async function handleAddPlayer(chatId, args, apiKey, chatName) {
    if (args.length === 0) {
        return forceReply('ADD_PLAYER');
    }

    const playerData = await getPlayerIdByNickname(apiKey, args[0]);
    if (!playerData) {
        return `❌ Player <b>${escapeHtml(args[0])}</b> not found on FACEIT.`;
    }

    await storageService.addPlayer(chatId, { id: playerData.playerId, nickname: playerData.nickname }, chatName);
    return `✅ Player <b>${escapeHtml(playerData.nickname)}</b> added to the list.`;
}

async function handleRemovePlayer(chatId, args) {
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
    return `🗑️ Player <b>${escapeHtml(player.nickname)}</b> removed from the list.`;
}

function handleHelp() {
    const lines = COMMAND_LIST.map(c => {
        const usage = c.args
            ? `<code>${c.command} ${c.args}</code>`
            : `<code>${c.command}</code>`;
        return `• ${usage} — ${c.description}`;
    });
    return `🤖 <b>Команды бота:</b>\n\n` + lines.join('\n');
}

async function handleSubscribe(chatId, args, apiKey) {
    if (args.length === 0) {
        return forceReply('SUBSCRIBE');
    }
    return subscribePlayerToChat(chatId, args[0], apiKey);
}

async function handleUnsubscribe(chatId, args, apiKey) {
    if (args.length === 0) {
        return forceReply('UNSUBSCRIBE');
    }
    return unsubscribePlayerFromChat(chatId, args[0], apiKey);
}

async function handleMySubscriptions(chatId) {
    const subscriptions = await storageService.getChatSubscriptions(chatId);
    if (subscriptions.length === 0) {
        return `📭 No active subscriptions. Use <code>${COMMANDS.SUBSCRIBE} &lt;nickname&gt;</code> to subscribe.`;
    }
    return `🔔 <b>Active subscriptions:</b>\n\n` + subscriptions.map(s => `• <code>${escapeHtml(s.nickname)}</code>`).join('\n');
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
            return handleRemovePlayer(chatId, args);
        case COMMANDS.PLAYERS:
            return handlePlayers(chatId);
        case COMMANDS.SUBSCRIBE:
            return handleSubscribe(chatId, args, apiKey);
        case COMMANDS.UNSUBSCRIBE:
            return handleUnsubscribe(chatId, args, apiKey);
        case COMMANDS.MY_SUBSCRIPTIONS:
            return handleMySubscriptions(chatId);
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