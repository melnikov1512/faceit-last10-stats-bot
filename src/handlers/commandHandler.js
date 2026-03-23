const { getLeaderboardStats, validatePlayer } = require('../services/faceitService');
const config = require('../config');
const storageService = require('../services/storageService');
const { COMMANDS } = require('../constants');

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
    let message = `📊 *FACEIT Last ${titleCount} Matches Stats*\n\n`;
    message += '```\n';

    // ── header ──────────────────────────────────────────────
    const h = (s) => s.padStart(COL);
    message += `${'Name'.padEnd(nameW)}${SEP}${h('ADR')}${SEP}${h('K/D')}${SEP}${h('Kill')}${SEP}${h('ELO')}${SEP}${h('±ELO')}\n`;
    const dash = '-'.repeat(COL);
    message += `${'-'.repeat(nameW)}${SEP}${dash}${SEP}${dash}${SEP}${dash}${SEP}${dash}${SEP}${dash}\n`;

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

        message += `${name}${SEP}${adr}${SEP}${kd}${SEP}${kill}${SEP}${elo}${SEP}${chg}\n`;
    });

    message += '```';
    return message;
}

async function handleStats(chatId, args, apiKey) {
    const players = await storageService.getPlayers(chatId);

    if (players.length === 0) {
        return `⚠️ No players tracked in this chat. Use \`${COMMANDS.ADD_PLAYER} <nickname>\` to start.`;
    }

    let matchesCount = config.last_matches || 10;
    if (args.length > 0) {
        const parsedCount = parseInt(args[0], 10);
        if (!isNaN(parsedCount) && parsedCount >= 2 && parsedCount <= 100) {
            matchesCount = parsedCount;
        }
    }

    const leaderboard = await getLeaderboardStats(
        apiKey,
        players,
        matchesCount
        );
    return formatStatsMessage(leaderboard, matchesCount);
}

async function handlePlayers(chatId) {
    const players = await storageService.getPlayers(chatId);
    if (players.length === 0) {
        return `⚠️ No players tracked in this chat. Use \`${COMMANDS.ADD_PLAYER} <nickname>\` to start.`;
    }
    return `📋 *Tracked Players:*\n\n` + players.map(p => `• \`${p}\``).join('\n');
}

async function handleAddPlayer(chatId, args, apiKey) {
    if (args.length === 0) {
        return `⚠️ Usage: \`${COMMANDS.ADD_PLAYER} <nickname>\``;
    } else {
        const nickname = args[0];
        const isValid = await validatePlayer(apiKey, nickname);

        if (isValid) {
            await storageService.addPlayer(chatId, nickname);
            return `✅ Player *${nickname}* added to the list.`;
        } else {
            return `❌ Player *${nickname}* not found on FACEIT.`;
        }
    }
}

async function handleRemovePlayer(chatId, args) {
    if (args.length === 0) {
        return `⚠️ Usage: \`${COMMANDS.REMOVE_PLAYER} <nickname>\``;
    } else {
        const nickname = args[0];
        await storageService.removePlayer(chatId, nickname);
        return `🗑️ Player *${nickname}* removed from the list.`;
    }
}

function handleHelp() {
    return '🤖 *Bot Commands:*\n\n' +
        `• \`${COMMANDS.STATS} [matches]\` - Get stats for the last N matches (default 10, range 2-100).\n` +
        `• \`${COMMANDS.ADD_PLAYER} <nickname>\` - Add a player to the tracking list.\n` +
        `• \`${COMMANDS.REMOVE_PLAYER} <nickname>\` - Remove a player from the tracking list.\n` +
        `• \`${COMMANDS.PLAYERS}\` - List all tracked players in this chat.\n` +
        `• \`${COMMANDS.HELP}\` - Show this help message.`;
}

async function handleCommand(command, chatId, args, apiKey) {
    switch (command) {
        case COMMANDS.STATS:
            return handleStats(chatId, args, apiKey);
        case COMMANDS.ADD_PLAYER:
            return handleAddPlayer(chatId, args, apiKey);
        case COMMANDS.REMOVE_PLAYER:
            return handleRemovePlayer(chatId, args);
        case COMMANDS.PLAYERS:
            return handlePlayers(chatId);
        case COMMANDS.HELP:
            return handleHelp();
        default:
            return null;
    }
}

module.exports = {
    handleCommand
};