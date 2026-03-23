const { getLeaderboardStats, validatePlayer } = require('../services/faceitService');
const config = require('../config');
const storageService = require('../services/storageService');
const { COMMANDS } = require('../constants');

const MAX_NAME_LENGTH = 9;

function formatStatsMessage(leaderboard, requestedMatchesCount) {
    if (!leaderboard || leaderboard.length === 0) {
        return 'Failed to retrieve stats for any player.';
    }

    // Column widths
    // Row width (name=9): 9 + 3 + 4 + 3 + 4 + 3 + 4 + 3 + 4 + 3 + 4 = 43 chars
    const KD_WIDTH      = 4;
    const ADR_WIDTH     = 4; // ADR displayed as 1 decimal → "90.7" = 4 chars
    const AVGK_WIDTH    = 4; // Avg kills 1 decimal → "17.7" = 4 chars
    const ELO_WIDTH     = 4;
    const ELO_CHG_WIDTH = 4; // "+999" / "-115" cover normal range

    // Dynamic name width capped at MAX_NAME_LENGTH (min 4 for "Name" header)
    const longestName  = leaderboard.reduce((max, p) => Math.max(max, p.nickname.length), 0);
    const nameColWidth = Math.max(4, Math.min(longestName, MAX_NAME_LENGTH));

    const titleCount = requestedMatchesCount || leaderboard[0].matchesAnalyzed || 10;
    let message = `📊 *FACEIT Last ${titleCount} Matches Stats*\n\n`;
    message += '```\n';

    // Header row
    const nameHeader   = 'Name'.padEnd(nameColWidth, ' ');
    const adrHeader    = 'ADR'.padStart(ADR_WIDTH, ' ');
    const kdHeader     = 'K/D'.padStart(KD_WIDTH, ' ');
    const avgKHeader   = 'Kill'.padStart(AVGK_WIDTH, ' ');
    const eloHeader    = 'ELO'.padStart(ELO_WIDTH, ' ');
    const eloChgHeader = '±ELO'.padStart(ELO_CHG_WIDTH, ' ');

    message += `${nameHeader} | ${adrHeader} | ${kdHeader} | ${avgKHeader} | ${eloHeader} | ${eloChgHeader}\n`;
    message += `${'-'.repeat(nameColWidth)} | ${'-'.repeat(ADR_WIDTH)} | ${'-'.repeat(KD_WIDTH)} | ${'-'.repeat(AVGK_WIDTH)} | ${'-'.repeat(ELO_WIDTH)} | ${'-'.repeat(ELO_CHG_WIDTH)}\n`;

    leaderboard.forEach(player => {
        // Truncate name if needed
        let name = player.nickname;
        if (name.length > nameColWidth) name = name.substring(0, nameColWidth);
        name = name.padEnd(nameColWidth, ' ');

        // 1 decimal for ADR and avg kills to keep column width at 4
        const kd   = player.kills_deaths_ratio.toString().padStart(KD_WIDTH, ' ');
        const adr  = parseFloat(player.average_damage_per_round).toFixed(1).padStart(ADR_WIDTH, ' ');
        const avgK = parseFloat(player.average_kills).toFixed(1).padStart(AVGK_WIDTH, ' ');

        // Current ELO
        const eloVal = player.current_elo != null
            ? player.current_elo.toString().padStart(ELO_WIDTH, ' ')
            : ' N/A';

        // ELO change with explicit sign
        let eloChgVal;
        if (player.elo_change != null) {
            const sign = player.elo_change >= 0 ? '+' : '';
            eloChgVal = `${sign}${player.elo_change}`.padStart(ELO_CHG_WIDTH, ' ');
        } else {
            eloChgVal = ' N/A';
        }

        message += `${name} | ${adr} | ${kd} | ${avgK} | ${eloVal} | ${eloChgVal}\n`;
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