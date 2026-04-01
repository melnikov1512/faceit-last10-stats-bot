require('dotenv').config();
const config = require('../config.json');

const isDev = process.env.NODE_ENV === 'development';

module.exports = {
  ...config,
  faceit_api_key: process.env.FACEIT_API_KEY || config.faceit_api_key,
  projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
  telegram_bot_token: isDev
    ? process.env.TELEGRAM_BOT_TOKEN_TEST
    : process.env.TELEGRAM_BOT_TOKEN,
  faceit_webhook_secret: process.env.FACEIT_WEBHOOK_SECRET
};