const { getLeaderboardStats, validatePlayer } = require('../services/faceitService');
const config = require('../config');
const storageService = require('../services/storageService');
const { COMMANDS } = require('../constants');

const MAX_NAME_LENGTH = 13;

function formatStatsMessage(leaderboard) {
    if (!leaderboard || leaderboard.length === 0) {
        return 'Failed to retrieve stats for any player.';
    }

    // specific column widths
    const KD_WIDTH = 4;
    const ADR_WIDTH = 6;

    // Calculate dynamic name width based on longest name in the list, capped at MAX_NAME_LENGTH
    const longestName = leaderboard.reduce((max, player) => Math.max(max, player.nickname.length), 0);
    const nameColWidth = Math.max(4, Math.min(longestName, MAX_NAME_LENGTH)); // At least 4 chars for "Name" header

    let message = '📊 *FACEIT Last 10 Matches Stats*\n\n';
    message += '```\n';
    
    // Header
    const nameHeader = 'Name'.padEnd(nameColWidth, ' ');
    const kdHeader = 'K/D'.padStart(KD_WIDTH, ' ');
    const adrHeader = 'ADR'.padStart(ADR_WIDTH, ' ');

    message += `${nameHeader} | ${kdHeader} | ${adrHeader}\n`;
    message += `${'-'.repeat(nameColWidth)} | ${'-'.repeat(KD_WIDTH)} | ${'-'.repeat(ADR_WIDTH)}\n`;

    leaderboard.forEach(player => {
        // Truncate name if too long to maintain table structure
        let name = player.nickname;
        if (name.length > nameColWidth) name = name.substring(0, nameColWidth);
        
        name = name.padEnd(nameColWidth, ' ');
        
        // Format stats
        const kd = player.kills_deaths_ratio.toString().padStart(KD_WIDTH, ' ');
        const adr = player.average_damage_per_round.toString().padStart(ADR_WIDTH, ' ');
        
        message += `${name} | ${kd} | ${adr}\n`;
    });
    message += '```';

    return message;
}

async function handleStats(chatId, apiKey) {
    const players = await storageService.getPlayers(chatId);

    if (players.length === 0) {
        return `⚠️ No players tracked in this chat. Use \`${COMMANDS.ADD_PLAYER} <nickname>\` to start.`;
    } else {
        const leaderboard = await getLeaderboardStats(
            apiKey,
            players,
            config.last_matches
        );
        return formatStatsMessage(leaderboard);
    }
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
        `• \`${COMMANDS.STATS}\` - Get stats for the last 10 matches for all tracked players.\n` +
        `• \`${COMMANDS.ADD_PLAYER} <nickname>\` - Add a player to the tracking list.\n` +
        `• \`${COMMANDS.REMOVE_PLAYER} <nickname>\` - Remove a player from the tracking list.\n` +
        `• \`${COMMANDS.HELP}\` - Show this help message.`;
}

async function handleCommand(command, chatId, args, apiKey) {
    switch (command) {
        case COMMANDS.STATS:
            return handleStats(chatId, apiKey);
        case COMMANDS.ADD_PLAYER:
            return handleAddPlayer(chatId, args, apiKey);
        case COMMANDS.REMOVE_PLAYER:
            return handleRemovePlayer(chatId, args);
        case COMMANDS.HELP:
            return handleHelp();
        default:
            return null;
    }
}

module.exports = {
    handleCommand
};