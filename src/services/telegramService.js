const axios = require('axios');
const config = require('../config');

/**
 * Send a message to a Telegram chat directly via Bot API.
 * Used for async notifications (e.g. FACEIT webhook events) where
 * the webhook reply mechanism is not available.
 * @param {string|number} chatId
 * @param {string} text  Markdown-formatted message
 */
async function sendMessage(chatId, text) {
    const token = config.telegram_bot_token;
    if (!token) {
        console.error('TELEGRAM_BOT_TOKEN is not configured');
        return;
    }

    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });
    } catch (error) {
        console.error(`Failed to send Telegram message to chat ${chatId}:`, error.message);
    }
}

module.exports = { sendMessage };
