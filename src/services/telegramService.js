const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');
const { BOT_COMMANDS } = require('../commands');

/**
 * Fetch the bot's own username via getMe and store it in config.
 * Called once at startup so other modules can use config.bot_username.
 */
async function fetchBotUsername() {
    const token = config.telegram_bot_token;
    if (!token) return;
    try {
        const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
        config.bot_username = res.data.result.username;
        console.log(`Bot username: @${config.bot_username}`);
    } catch (error) {
        console.error('Failed to fetch bot username:', error.message);
    }
}

/**
 * Register bot commands with Telegram so they appear in the "/" menu.
 * Safe to call on every deploy — Telegram ignores duplicate identical calls.
 */
async function setMyCommands() {
    const token = config.telegram_bot_token;
    if (!token) {
        console.error('setMyCommands: TELEGRAM_BOT_TOKEN is not configured');
        return;
    }

    try {
        await axios.post(`https://api.telegram.org/bot${token}/setMyCommands`, {
            commands: BOT_COMMANDS,
        });
        console.log('Bot commands registered successfully');
    } catch (error) {
        console.error('Failed to register bot commands:', error.message);
    }
}

async function sendMessage(chatId, text, replyMarkup = null) {
    const token = config.telegram_bot_token;
    if (!token) {
        console.error('TELEGRAM_BOT_TOKEN is not configured');
        return;
    }

    try {
        const payload = {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
        };
        if (replyMarkup) payload.reply_markup = replyMarkup;

        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, payload);
    } catch (error) {
        console.error(`Failed to send Telegram message to chat ${chatId}:`, error.message);
    }
}

async function sendPhoto(chatId, imageBuffer, caption = null, replyMarkup = null) {
    const token = config.telegram_bot_token;
    if (!token) {
        console.error('TELEGRAM_BOT_TOKEN is not configured');
        return;
    }

    try {
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('photo', imageBuffer, { filename: 'stats.png', contentType: 'image/png' });
        if (caption) {
            form.append('caption', caption);
            form.append('parse_mode', 'HTML');
        }
        if (replyMarkup) {
            form.append('reply_markup', JSON.stringify(replyMarkup));
        }

        await axios.post(
            `https://api.telegram.org/bot${token}/sendPhoto`,
            form,
            { headers: form.getHeaders() }
        );
    } catch (error) {
        console.error(`Failed to send Telegram photo to chat ${chatId}:`, error.message);
        throw error;
    }
}

module.exports = { sendMessage, sendPhoto, setMyCommands, fetchBotUsername };
