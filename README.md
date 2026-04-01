# Faceit Last 10 Stats Bot

A Node.js Telegram bot designed to run as a **Google Cloud Function** (HTTP Trigger). Fetches **FACEIT Data API v4** statistics for **Counter-Strike 2** and communicates with Telegram via Webhook Replies.

## Features

- **Stats**: K/D, ADR, average kills, current ELO, ELO change over last N matches
- **Player management**: add/remove tracked players per chat (stored in Firestore by FACEIT player ID)
- **Match notifications**: real-time match-start alerts via FACEIT webhooks; multiple subscribed players in the same match produce one grouped notification
- **Batched processing**: player stats fetched in parallel chunks of 10 to respect API rate limits

## Commands

| Command | Description |
|---|---|
| `/stats [N]` | Stats for the last N matches (default 10, range 2–100) |
| `/add_player <nickname>` | Add a player to this chat's tracking list |
| `/remove_player <nickname>` | Remove a player from tracking |
| `/players` | List all tracked players in this chat |
| `/subscribe <nickname>` | Subscribe to match-start notifications for a player |
| `/unsubscribe <nickname>` | Unsubscribe from a player's notifications |
| `/my_subscriptions` | List active subscriptions in this chat |
| `/help` | Show this list |

## Prerequisites

1. **Node.js 20+**
2. **FACEIT API Key** — create an app at [developers.faceit.com](https://developers.faceit.com/)
3. **Telegram Bot Token** — obtain from [@BotFather](https://t.me/botfather)
4. **Google Cloud Project** with Firestore enabled in **Native Mode**
   - Console → Firestore → Create Database → Native Mode

## Configuration

Create a `.env` file in the project root:

```env
FACEIT_API_KEY=your_faceit_api_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GCLOUD_PROJECT=your_google_cloud_project_id
FACEIT_WEBHOOK_SECRET=your_webhook_secret        # optional, recommended
GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json # local only, if not using gcloud auth
```

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server

```bash
npm run dev
```

Starts an ngrok tunnel (`huddlingly-shirty-chantal.ngrok-free.dev`) and the Express server concurrently.

### 3. Register the Telegram webhook

Run once (or whenever the webhook URL changes):

```bash
node scripts/set-webhook.js   # no longer exists — use curl instead
```

Or directly via curl:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://huddlingly-shirty-chantal.ngrok-free.dev/"
```

### 4. Test endpoints

```bash
# Health check
curl http://localhost:8080/

# Simulate a Telegram update
curl -X POST http://localhost:8080/ \
  -H "Content-Type: application/json" \
  -d '{"message":{"chat":{"id":123},"text":"/help","entities":[{"type":"bot_command","offset":0,"length":5}]}}'

# Simulate a FACEIT webhook event
curl -X POST http://localhost:8080/webhook/faceit \
  -H "Content-Type: application/json" \
  -H "x-faceit-webhook-secret: your_secret" \
  -d '{"id":"match-id","event":"match_status_ready","teams":{...}}'
```

### Firestore locally

Set `GOOGLE_APPLICATION_CREDENTIALS` to a service account key JSON, or run:

```bash
gcloud auth application-default login
```

## Deployment (Google Cloud Functions)

1. **Trigger**: HTTP
2. **Runtime**: Node.js 20
3. **Entry Point**: `telegramBot`
4. **Environment Variables**: set `FACEIT_API_KEY`, `TELEGRAM_BOT_TOKEN`, `FACEIT_WEBHOOK_SECRET`, `GCLOUD_PROJECT` in the Cloud Function runtime settings
5. After deploying, register the webhook:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-function-url>/"
   ```

## FACEIT Webhook Setup (Match Notifications)

One-time setup in [FACEIT Developer Portal → App Studio](https://developers.faceit.com/).

1. **Webhooks → Create Subscription**
2. **Subscription Type**: User → *Static list of other users*
3. **Add player GUIDs** — when a user runs `/subscribe <nickname>`, the bot logs the player's GUID in Cloud Function logs
4. **Event**: `match_status_ready`
5. **Callback URL**: `https://<your-function-url>/webhook/faceit`
6. **Security Header**:
   - Name: `x-faceit-webhook-secret`
   - Value: the value you set in `FACEIT_WEBHOOK_SECRET`

> When a new player is subscribed via `/subscribe`, manually add their FACEIT GUID to the App Studio webhook subscription. The GUID is logged automatically.

## Project Structure

```
index.js                          # Entry point; exports telegramBot for GCF
src/
  app.js                          # Express app and routes
  config.js                       # Config loader (env vars + config.json)
  commands.js                     # Single source of truth for all bot commands
  handlers/
    webhookHandler.js             # Telegram update routing and response
    faceitWebhookHandler.js       # FACEIT webhook validation and dispatch
    commandHandler.js             # Business logic for all bot commands
  services/
    faceitService.js              # FACEIT API client and stats calculation
    storageService.js             # Firestore operations
    subscriptionService.js        # Match notification logic
    telegramService.js            # Telegram Bot API (push notifications)
config.json                       # Default config values (no secrets)
```

