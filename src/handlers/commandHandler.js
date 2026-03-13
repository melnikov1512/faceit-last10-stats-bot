const { getLeaderboardStats, validatePlayer } = require('../services/faceitService');
const config = require('../config');
const storageService = require('../services/storageService');
const { COMMANDS } = require('../constants');

const MAX_NAME_LENGTH = 13;

function formatStatsMessage(leaderboard, requestedMatchesCount) {
    if (!leaderboard || leaderboard.length === 0) {
        return 'Failed to retrieve stats for any player.';
    }

    // specific column widths
    const KD_WIDTH = 4;
    const ADR_WIDTH = 6;
    const AVGK_WIDTH = 5;
    const MATCHES_WIDTH = 3;

    // Calculate dynamic name width based on longest name in the list, capped at MAX_NAME_LENGTH
    const longestName = leaderboard.reduce((max, player) => Math.max(max, player.nickname.length), 0);
    const nameColWidth = Math.max(4, Math.min(longestName, MAX_NAME_LENGTH)); // At least 4 chars for "Name" header

    const titleCount = requestedMatchesCount || leaderboard[0].matchesAnalyzed || 10;
    let message = `📊 *FACEIT Last ${titleCount} Matches Stats*\n\n`;
    message += '```\n';
    
    // Header
    const nameHeader = 'Name'.padEnd(nameColWidth, ' ');
    const adrHeader = 'ADR'.padStart(ADR_WIDTH, ' ');
    const kdHeader = 'K/D'.padStart(KD_WIDTH, ' ');
    const avgKHeader = 'AvgK'.padStart(AVGK_WIDTH, ' ');
    const matchesHeader = '#'.padStart(MATCHES_WIDTH, ' ');

    message += `${nameHeader} | ${adrHeader} | ${kdHeader} | ${avgKHeader} | ${matchesHeader}\n`;
    message += `${'-'.repeat(nameColWidth)} | ${'-'.repeat(ADR_WIDTH)} | ${'-'.repeat(KD_WIDTH)} | ${'-'.repeat(AVGK_WIDTH)} | ${'-'.repeat(MATCHES_WIDTH)}\n`;

    leaderboard.forEach(player => {
        // Truncate name if too long to maintain table structure
        let name = player.nickname;
        if (name.length > nameColWidth) name = name.substring(0, nameColWidth);
        
        name = name.padEnd(nameColWidth, ' ');
        
        // Format stats
        const kd = player.kills_deaths_ratio.toString().padStart(KD_WIDTH, ' ');
        const adr = player.average_damage_per_round.toString().padStart(ADR_WIDTH, ' ');
        const avgK = player.average_kills.toString().padStart(AVGK_WIDTH, ' ');
        const matches = (player.matchesAnalyzed || 0).toString().padStart(MATCHES_WIDTH, ' ');
        
        message += `${name} | ${adr} | ${kd} | ${avgK} | ${matches}\n`;
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
        if (!isNaN(parsedCount) && parsedCount >= 2 && parsedCount <= 90) {
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
        `• \`${COMMANDS.STATS} [matches]\` - Get stats for the last N matches (default 10, range 2-90).\n` +
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