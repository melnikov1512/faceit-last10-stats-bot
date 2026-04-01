/**
 * Entry point for Google Cloud Function (HTTP Trigger)
 *
 * @param {Object} req Cloud Function request context.
 * @param {Object} res Cloud Function response context.
 */
require('dotenv').config();
const app = require('./src/app');
const { setMyCommands, setChatMenuButton, setDefaultMenuButton, fetchBotUsername } = require('./src/services/telegramService');
const storageService = require('./src/services/storageService');
const config = require('./src/config');

// Register bot commands on every startup so the "/" menu stays up to date
fetchBotUsername();
setMyCommands();

// Set global menu button for group chats (no chat_id = default for all chats)
// Per-user buttons set in setupMenuButtons() will override this for private chats.
if (config.webapp_url) {
    setDefaultMenuButton(config.webapp_url);
}

// Set menu button for all known private chats once on startup
async function setupMenuButtons() {
    if (!config.webapp_url) return;

    try {
        // Collect all known chatIds from both collections
        const chatIds = new Set();

        const chats = await storageService.getAllChatIds();
        for (const id of chats) chatIds.add(id);

        const subs = await storageService.getAllSubscribedChatIds();
        for (const id of subs) chatIds.add(id);

        // Only private chats have positive IDs
        const privateChatIds = [...chatIds].filter(id => Number(id) > 0);
        console.log(`[MENU] Setting menu button for ${privateChatIds.length} private chats`);

        for (const chatId of privateChatIds) {
            await setChatMenuButton(chatId, `${config.webapp_url}?chatId=${chatId}`);
        }
    } catch (err) {
        console.error('[MENU] Failed to setup menu buttons:', err.message);
    }
}

setupMenuButtons();

// Start server on port 8080 if run directly
if (require.main === module) {
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => {
        console.log(`Telegram bot server started on port ${PORT}`);
    });
}

// Export app for Google Cloud Functions
exports.telegramBot = app;