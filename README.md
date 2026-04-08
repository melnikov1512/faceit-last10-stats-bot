# FACEIT Last 10 Stats Bot

A Node.js Telegram bot that tracks **Counter-Strike 2** player statistics from [FACEIT](https://www.faceit.com/). Designed to run as a **Google Cloud Function** (HTTP trigger) or a standalone Express server. Communicates with Telegram via the Webhook Reply pattern and sends match notifications via FACEIT webhooks.

## Features

- **Stats leaderboard** — K/D, ADR, average kills, current ELO, and ELO change over the last N matches, rendered as a FACEIT-styled PNG image
- **Match-start notifications** — real-time alerts with team rosters, ELO, and win probability, triggered by FACEIT webhooks
- **Match-finish notifications** — per-player WIN/LOSE cards with ELO delta and stats, aggregated into one image per chat
- **Player management** — add/remove tracked players per chat; stored in Firestore by FACEIT player ID
- **Active matches Mini App** — Telegram Web App (`/live`) showing live rosters, ELO badges, and scores
- **Parallel processing** — player stats fetched in chunks of 10 with three concurrent requests per player

## Requirements

- Node.js 20+
- [FACEIT Data API key](https://developers.faceit.com/) (OpenAPI v4)
- [Telegram Bot Token](https://t.me/botfather)
- Google Cloud project with Firestore in **Native Mode**

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
FACEIT_API_KEY=your_faceit_api_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GCLOUD_PROJECT=your_gcp_project_id          # or GOOGLE_CLOUD_PROJECT
FACEIT_WEBHOOK_SECRET=your_webhook_secret   # optional, recommended
GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json  # local only
WEBAPP_URL=https://your-domain/app          # optional — enables Mini App button
BOT_USERNAME=your_bot_username              # optional — auto-fetched at startup
```

> [!WARNING]
> Never commit secrets to `config.json`. Use `.env` locally and Runtime Environment Variables in Google Cloud.

### 3. Start the dev server

```bash
npm run dev
```

Starts an ngrok tunnel and the Express server concurrently.

> [!NOTE]
> The ngrok URL in `package.json` is a static domain (`huddlingly-shirty-chantal.ngrok-free.dev`). Update it if your domain changes.

### 4. Register the Telegram webhook

Run once, or whenever the public URL changes:

```bash
npm run set-webhook
```

### 5. Verify the server is running

```bash
curl http://localhost:8080/health
```

## Bot commands

| Command | Arguments | Description |
|---|---|---|
| `/stats` | `[N]` (2–100, default 10) | Stats image for the last N matches |
| `/add_player` | `<nickname>` | Add a player to this chat's tracking list |
| `/remove_player` | `<nickname>` | Remove a player from tracking |
| `/players` | — | List all tracked players in this chat |
| `/live` | — | Open Mini App with active matches (requires `WEBAPP_URL`) |
| `/help` | — | Show command list |

## npm scripts

| Script | Description |
|---|---|
| `npm start` | Production start |
| `npm run dev` | Local dev with ngrok tunnel |
| `npm run set-webhook` | Register Telegram webhook URL |
| `npm run test-notify -- --nickname <nick> --chatId <id>` | Simulate a match-start FACEIT webhook |
| `npm run test-notify-finish -- --nickname <nick> --chatId <id>` | Simulate a match-finish FACEIT webhook |

Add `--force` to `test-notify-finish` to bypass Firestore subscriptions and send the result card directly. Add `--matchId <id>` to use a specific match.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/` | Telegram webhook updates |
| `POST` | `/webhook/faceit` | FACEIT match event webhooks |
| `GET` | `/api/active-matches?chatId=<id>` | Active matches for a chat (JSON) |
| `GET` | `/api/match?matchId=<id>&chatId=<id>` | Single match details with stats (JSON) |
| `GET` | `/app` | Telegram Mini App (static) |
| `GET` | `/health` | Health check — returns `200 OK` |

## Deployment (Google Cloud Functions / Cloud Run)

1. Set **Trigger** to HTTP, **Runtime** to Node.js 20, **Entry point** to `telegramBot`
2. Set environment variables: `FACEIT_API_KEY`, `TELEGRAM_BOT_TOKEN`, `FACEIT_WEBHOOK_SECRET`, `GCLOUD_PROJECT`; optionally `WEBAPP_URL`, `BOT_USERNAME`
3. Use `GET /health` as the health check path
4. After deploying, register the Telegram webhook:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-function-url>/"
   ```

## FACEIT webhook setup

One-time setup in the [FACEIT Developer Portal → App Studio](https://developers.faceit.com/):

1. **Webhooks → Create Subscription**
2. Set type to **User → Static list of other users**, then add tracked player GUIDs
3. Enable events: `match_status_ready`, `match_status_finished`
4. Set **Callback URL** to `https://<your-function-url>/webhook/faceit`
5. Add security header `x-faceit-webhook-secret` matching your `FACEIT_WEBHOOK_SECRET`

> [!NOTE]
> When a player is added via `/add_player`, they are automatically subscribed in Firestore. You still need to add their FACEIT GUID to the App Studio webhook subscription manually.

## Project structure

```
index.js                              # Entry point; exports telegramBot for GCF
src/
  app.js                              # Express app setup and routes
  config.js                           # Config loader (env vars + config.json)
  commands.js                         # Single source of truth for all bot commands
  constants.js                        # Shared runtime constants
  utils.js                            # Shared utility functions
  handlers/
    webhookHandler.js                 # Telegram update routing and response dispatch
    faceitWebhookHandler.js           # FACEIT webhook validation and async dispatch
    commandHandler.js                 # Business logic for all bot commands
    apiHandler.js                     # REST handlers for /api/* endpoints
  services/
    faceitService.js                  # FACEIT API client and stats calculation
    imageService.js                   # PNG card generation (@napi-rs/canvas)
    storageService.js                 # Firestore operations
    subscriptionService.js            # Match-start/finish notification logic
    matchService.js                   # Active match ID collection and filtering
    telegramService.js                # Telegram Bot API push notifications
  data/
    matchFinishMessages.js            # Message pool for finish notifications
  assets/fonts/                       # Bundled Inter WOFF2 fonts
public/
  index.html                          # Telegram Mini App
scripts/
  set-webhook.js                      # Register Telegram webhook URL
  test-notify.js                      # Simulate match-start webhook (dev)
  test-notify-finish.js               # Simulate match-finish webhook (dev)
  backfill-notification-playerids.js  # One-time Firestore migration
config.json                           # Default config values (no secrets)
```

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Server | Express.js |
| HTTP client | Axios + native `fetch` |
| Database | Google Cloud Firestore (Native Mode) |
| Image generation | `@napi-rs/canvas` |
| Config | `dotenv` |
| Dev tooling | `concurrently`, ngrok |
