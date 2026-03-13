const { getLeaderboardStats, validatePlayer } = require('../services/faceitService');
const config = require('../config');
const storageService = require('../services/storageService');
const { COMMANDS } = require('../constants');

const MAX_NAME_LENGTH = 20;

function formatStatsMessage(leaderboard) {
    if (!leaderboard || leaderboard.length === 0) {
        return 'Failed to retrieve stats for any player.';
    }

    let message = '📊 *FACEIT Last 10 Matches Stats*\n\n';
    message += '```\n';
    // Header
    const nameHeader = 'Name'.padEnd(MAX_NAME_LENGTH, ' ');
    message += `${nameHeader} | ADR    | K/D    | Avg K\n`;
    message += `${'-'.repeat(MAX_NAME_LENGTH)} |--------|--------|------\n`;

    leaderboard.forEach(player => {
        // Truncate name if too long to maintain table structure
        let name = player.nickname;
        if (name.length > MAX_NAME_LENGTH) name = name.substring(0, MAX_NAME_LENGTH);
        
        name = name.padEnd(MAX_NAME_LENGTH, ' ');
        const adr = player.average_damage_per_round.toString().padStart(6, ' ');
        const kd = player.kills_deaths_ratio.toString().padStart(6, ' ');
        const kills = player.average_kills.toString().padStart(5, ' ');
        message += `${name} | ${adr} | ${kd} | ${kills}\n`;
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