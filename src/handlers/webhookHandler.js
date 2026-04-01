const { handleCommand } = require('./commandHandler');
const config = require('../config');
const { COMMANDS } = require('../constants');

async function handleWebhook(req, res) {
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

    // Split by whitespace to handle multiple spaces
    const parts = text.trim().split(/\s+/);
    if (parts.length === 0) return res.sendStatus(200);

    const cmdRaw = parts[0];
    const args = parts.slice(1);
    
    const command = cmdRaw.split('@')[0];

    const allowedCommands = Object.values(COMMANDS);
    if (!allowedCommands.includes(command)) {
        return res.sendStatus(200);
    }

    try {
        const apiKey = config.faceit_api_key;

        if (!apiKey) {
            console.error('FACEIT_API_KEY is missing');
            return res.json({
                method: 'sendMessage',
                chat_id: chatId,
                text: '⚠️ Bot configuration error (API Key).'
            });
        }

        const responseText = await handleCommand(command, chatId, args, apiKey);

        const replyPayload = {
            method: 'sendMessage',
            chat_id: chatId,
            text: responseText,
            parse_mode: 'HTML'
        };

        res.json(replyPayload);
    } catch (error) {
        console.error(`Error processing ${command}:`, error);
        if (error.stack) {
             console.error(error.stack);
        }

        const replyPayload = {
            method: 'sendMessage',
            chat_id: chatId,
            text: `⚠️ Error processing request: ${error.message || 'Please try again later.'}`
        };
        res.json(replyPayload);
    }
}

module.exports = {
    handleWebhook
};