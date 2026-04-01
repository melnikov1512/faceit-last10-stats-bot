require('dotenv').config();
const config = require('../config.json');

module.exports = {
  ...config,
  faceit_api_key: process.env.FACEIT_API_KEY || config.faceit_api_key,
  projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
  telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN,
  faceit_webhook_secret: process.env.FACEIT_WEBHOOK_SECRET,
  webapp_url: process.env.WEBAPP_URL || null,
  bot_username: process.env.BOT_USERNAME || null, // auto-populated at startup via getMe
};