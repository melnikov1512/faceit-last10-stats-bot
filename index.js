/**
 * Entry point for Google Cloud Function (HTTP Trigger)
 *
 * @param {Object} req Cloud Function request context.
 * @param {Object} res Cloud Function response context.
 */
require('dotenv').config();
const express = require('express');
const { getLeaderboardStats } = require('./faceit/stats');
const config = require('./config.json');

const app = express();
const MAX_NAME_LENGTH = 20;

app.use(express.json());

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

// Telegram webhook handler
app.post('/', async (req, res) => {
    const { body } = req;
    
    // Log incoming object for debugging in Google Cloud Logs
    console.log('Received update:', JSON.stringify(body));

    const { message } = body;
    const chatId = message?.chat?.id;
    const text = message?.text;

    // If no text or chat ID, return 200 to prevent Telegram from retrying
    if (!chatId || !text) {
        return res.sendStatus(200);
    }

    // Process only /stats command
    if (!text.startsWith('/stats')) {
        // Ignore all other messages
        return res.sendStatus(200);
    }

    try {
        // Get API key from environment variables or config
        const apiKey = process.env.FACEIT_API_KEY || config.faceit_api_key;

        if (!apiKey) {
            console.error('FACEIT_API_KEY is missing');
            return res.json({
                method: 'sendMessage',
                chat_id: chatId,
                text: '⚠️ Bot configuration error (API Key).'
            });
        }

        // Get stats
        const leaderboard = await getLeaderboardStats(
            apiKey, 
            config.users, 
            config.last_matches
        );
        
        const responseText = formatStatsMessage(leaderboard);

        // Form Webhook Reply for /stats command
        const replyPayload = {
            method: 'sendMessage',
            chat_id: chatId,
            text: responseText,
            parse_mode: 'Markdown'
        };

        res.json(replyPayload);
    } catch (error) {
        console.error('Error processing /stats:', error);
        
        const replyPayload = {
            method: 'sendMessage',
            chat_id: chatId,
            text: `⚠️ Error retrieving statistics. Please try again later.`
        };
        res.json(replyPayload);
    }
});

// Health check handler
app.get('/', (req, res) => {
    res.status(200).send('OK');
});

// Start server on port 8080
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Telegram bot server started on port ${PORT}`);
});