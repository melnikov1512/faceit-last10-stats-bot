require('dotenv').config();
const app = require('./src/app');
const { setMyCommands, fetchBotUsername } = require('./src/services/telegramService');

// Register bot commands on every startup so the "/" menu stays up to date
fetchBotUsername();
setMyCommands();

// Start server on port 8080 if run directly
if (require.main === module) {
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => {
        console.log(`Telegram bot server started on port ${PORT}`);
    });
}

// Export app for Google Cloud Functions
exports.telegramBot = app;