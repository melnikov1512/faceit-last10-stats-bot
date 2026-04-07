# FACEIT Last 10 Stats Bot

A Node.js Telegram bot designed to run as a **Google Cloud Function** (HTTP Trigger) or standalone Express server. Fetches **FACEIT Data API v4** statistics for **Counter-Strike 2 (CS2)** and communicates with Telegram via Webhook Replies.

## Features

- **Stats image**: K/D, ADR, average kills, current ELO, ELO change over last N matches — rendered as a FACEIT-styled PNG leaderboard card
- **Match-start notifications**: real-time alerts via FACEIT webhooks with team rosters, ELO, and win probability
- **Match-finish notifications**: per-player result cards (WIN/LOSE badge, ELO delta, stats) aggregated into one image per chat
- **Player management**: add/remove tracked players per chat (stored in Firestore by FACEIT player ID)
- **Active matches Mini App**: Telegram Web App (`/live`) showing live match rosters, ELO, and scores
- **Batched processing**: player stats fetched in parallel chunks of 10 to respect API rate limits

## Commands

| Command | Arguments | Description |
|---|---|---|
| `/stats` | `[N]` (2–100, default 10) | Stats image for the last N matches |
| `/add_player` | `<nickname>` | Add a player to this chat's tracking list |
| `/remove_player` | `<nickname>` | Remove a player from tracking |
| `/players` | — | List all tracked players in this chat |
| `/live` | — | Open Mini App with active matches (requires `WEBAPP_URL`) |
| `/help` | — | Show command list |

## Requirements

1. **Node.js 20+**
2. **FACEIT API Key** — create an app at [developers.faceit.com](https://developers.faceit.com/)
3. **Telegram Bot Token** — obtain from [@BotFather](https://t.me/botfather)
4. **Google Cloud Project** with Firestore enabled in **Native Mode**
   - Console → Firestore → Create Database → **Native Mode**

## Environment Variables

Create a `.env` file in the project root for local development:

```env
FACEIT_API_KEY=your_faceit_api_key           # required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token   # required
GCLOUD_PROJECT=your_gcp_project_id           # required (or GOOGLE_CLOUD_PROJECT)
FACEIT_WEBHOOK_SECRET=your_webhook_secret    # optional, recommended
GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json  # local only, if not using gcloud auth
WEBAPP_URL=https://your-domain/app           # optional, enables Mini App button in notifications
BOT_USERNAME=your_bot_username               # optional, auto-fetched at startup via getMe
```

> **Never commit secrets to `config.json`.** Use `.env` locally and Runtime Environment Variables in Google Cloud.

## Setup & Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the env vars above into a `.env` file.

### 3. Start the dev server

```bash
npm run dev
```

Starts an ngrok tunnel and the Express server concurrently (via `concurrently`).

### 4. Register the Telegram webhook

Run once (or whenever the public URL changes):

```bash
npm run set-webhook
```

Or manually via curl:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-ngrok-url>/"
```

### 5. Health check

```bash
curl http://localhost:8080/health
```

## npm Scripts

| Script | Command | Description |
|---|---|---|
| `npm start` | `node index.js` | Production start |
| `npm run dev` | `concurrently ngrok + node` | Local dev with ngrok tunnel |
| `npm run set-webhook` | `node scripts/set-webhook.js` | Register Telegram webhook URL |
| `npm run test-notify` | `node scripts/test-notify.js` | Simulate a match-start FACEIT webhook |
| `npm run test-notify-finish` | `node scripts/test-notify-finish.js` | Simulate a match-finish FACEIT webhook |

### Test scripts usage

```bash
# Simulate match-start notification
npm run test-notify -- --nickname <nick> --chatId <chatId>

# Simulate match-finish notification
npm run test-notify-finish -- --nickname <nick> --chatId <chatId>
# Add --force to bypass Firestore subscriptions and send directly
# Add --matchId <id> to use a specific match
```

## Deployment (Google Cloud Functions / Cloud Run)

1. **Trigger**: HTTP
2. **Runtime**: Node.js 20
3. **Entry Point**: `telegramBot` (exported from `index.js`)
4. **Health check path**: `GET /health`
5. Set environment variables in the Cloud Function runtime settings:
   - `FACEIT_API_KEY`, `TELEGRAM_BOT_TOKEN`, `FACEIT_WEBHOOK_SECRET`, `GCLOUD_PROJECT`
   - Optionally: `WEBAPP_URL`, `BOT_USERNAME`
6. After deploying, register the webhook:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-function-url>/"
   ```

## FACEIT Webhook Setup (Match Notifications)

One-time setup in [FACEIT Developer Portal → App Studio](https://developers.faceit.com/).

1. **Webhooks → Create Subscription**
2. **Subscription Type**: User → *Static list of other users*
3. **Add player GUIDs** of players you want to track
4. **Events**: `match_status_ready`, `match_status_finished`
5. **Callback URL**: `https://<your-function-url>/webhook/faceit`
6. **Security Header**:
   - Name: `x-faceit-webhook-secret`
   - Value: the value you set in `FACEIT_WEBHOOK_SECRET`

> When a player is added via `/add_player`, they are automatically subscribed in Firestore. You still need to add their FACEIT GUID to the App Studio webhook subscription manually. The GUID is logged at startup and on add.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Telegram webhook updates |
| `POST` | `/webhook/faceit` | FACEIT match event webhooks |
| `GET` | `/api/active-matches?chatId=<id>` | Active matches for a chat (JSON) |
| `GET` | `/api/match?matchId=<id>&chatId=<id>` | Single match details with stats (JSON) |
| `GET` | `/app` | Telegram Mini App (static) |
| `GET` | `/health` | Health check — returns `200 OK` |

## Project Structure

```
index.js                              # Entry point; exports telegramBot for GCF
src/
  app.js                              # Express app setup and route definitions
  config.js                           # Config loader (env vars + config.json)
  commands.js                         # Single source of truth for all bot commands
  constants.js                        # Shared runtime constants
  utils.js                            # Shared utility functions (escapeHtml)
  handlers/
    webhookHandler.js                 # Telegram update routing and response dispatch
    faceitWebhookHandler.js           # FACEIT webhook validation and async dispatch
    commandHandler.js                 # Business logic for all bot commands
    apiHandler.js                     # REST handlers for /api/* endpoints
  services/
    faceitService.js                  # FACEIT API client and stats calculation
    imageService.js                   # PNG card generation (@napi-rs/canvas)
    storageService.js                 # Firestore operations (players, subscriptions)
    subscriptionService.js            # Match-start/finish notification logic
    matchService.js                   # Active match ID collection and filtering
    telegramService.js                # Telegram Bot API (push notifications)
  data/
    matchFinishMessages.js            # Funny message pool for finish notifications
  assets/
    fonts/                            # Bundled Inter WOFF2 fonts
public/
  index.html                          # Telegram Mini App web page
scripts/
  set-webhook.js                      # Register Telegram webhook URL
  test-notify.js                      # Simulate match-start webhook (dev only)
  test-notify-finish.js               # Simulate match-finish webhook (dev only)
  backfill-notification-playerids.js  # One-time Firestore migration script
config.json                           # Default config values (no secrets)
ai-files/
  LOCAL_TESTING.md                    # Local testing guide
  faceit-open-api.json                # FACEIT Data API v4 OpenAPI spec
```

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Server | Express.js |
| HTTP Client | Axios + native `fetch` |
| Database | Google Cloud Firestore (Native Mode) |
| Image generation | `@napi-rs/canvas` |
| Config | `dotenv` |
| Dev tooling | `concurrently`, ngrok |

## Tests

> **TODO**: No automated test suite is currently present. Manual testing is done via `npm run test-notify` and `npm run test-notify-finish` scripts.

## License

> **TODO**: No license file found in the repository. Add a `LICENSE` file if you intend to open-source this project.
