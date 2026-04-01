# AGENTS.md - Faceit Last 10 Stats Bot

## AI Agent Rules

> These rules are mandatory and must be followed in every session.

1. **Never commit automatically.** Do not run `git commit` (or any command that creates a commit) without explicit user instruction. Always show the proposed changes and wait for approval before committing.

2. **Tool priority order.** When solving a task, prefer tools in this order:
   1. Built-in tools (grep, glob, view, edit, create, bash, sql, etc.)
   2. MCP servers (GitHub MCP, etc.)
   3. Ecosystem CLI tools (`npm`, `git`, `gcloud`, etc.)
   4. Custom scripts — use only as a last resort when built-in tools cannot accomplish the task.

## Project Overview
This is a Node.js Telegram bot designed to run as a **Google Cloud Function** (HTTP Trigger). It fetches **FACEIT Data API v4** statistics for **Counter-Strike 2 (CS2)** and communicates with Telegram via **Webhook Replies**.

The stats fetching module is located in `src/services/faceitService.js` and is integrated into the main bot logic.

## Architecture & Core logic
- **Entry Point**: `index.js` loads the app from `src/app.js` and starts the server. Exports `telegramBot` for Google Cloud Functions; listens on `PORT` (default 8080) when run directly.
- **Webhook Pattern**: The bot uses the [Webhook Reply](https://core.telegram.org/bots/api#making-requests-when-getting-updates) mechanism.
  - **Logic**: Handled in `src/handlers/webhookHandler.js`. Uses **HTML** parse mode for responses.
  - **Example**:
    ```javascript
    const replyPayload = {
        method: 'sendMessage',
        chat_id: chatId,
        text: '...',
        parse_mode: 'HTML'
    };
    res.json(replyPayload);
    ```
- **Stats Module**: `src/services/faceitService.js`. Calculates average stats (ADR, K/D, kills, ELO, ELO change) from the last N matches.
    - **Faceit API**: Uses v4 `/players?nickname={nick}&game=cs2`, `/players/{id}/games/cs2/stats?limit={N}`, and the unofficial ELO timeline endpoint `https://api.faceit.com/stats/v1/stats/time/users/{playerId}/games/cs2`. Match details fetched via `/matches/{matchId}` as fallback.
    - **ELO API Note**: The unofficial ELO timeline endpoint is fetched using Node.js native `fetch` (not axios) to bypass Cloudflare protection.
    - **Batching**: Processes player lookups in chunks of 10 to manage API rate limits. Game stats and ELO timeline fetched in parallel per player.
    - **Output**: Sorted by ADR descending. Formatted as an HTML-escaped table: `Name | ADR | K/D | Kills | ELO | ±ELO`.
- **Storage Module**: `src/services/storageService.js`. Manages per-chat data using Firestore.
    - **Collections**:
        - `chats` — Document ID = `chatId`. Structure: `{ players: ["nickname1", "nickname2"] }`.
        - `player_subscriptions` — Document ID = `playerId` (FACEIT GUID). Structure: `{ playerId, nickname, subscribedChats: [chatIds] }`.
        - `sent_match_notifications` — Document ID = `{matchId}_{chatId}`. Fields: `matchId`, `chatId`, `sentAt`. Used for deduplication.
    - **Requirement**: Firestore database must be created in **Native Mode**.
- **Subscription Module**: `src/services/subscriptionService.js`. Handles match-start event logic triggered by FACEIT webhooks. Queries subscriptions, deduplicates notifications, and dispatches Telegram messages.
    - **Supported Event**: `match_status_ready`.
    - **FACEIT Webhook Handler**: `src/handlers/faceitWebhookHandler.js` validates the `x-faceit-webhook-secret` header, responds `200` immediately, then processes the event asynchronously via `handleMatchEvent()`.
- **Telegram Module**: `src/services/telegramService.js`. Sends messages to Telegram chats via Bot API (used for push notifications from FACEIT webhook events, not the webhook reply mechanism).
- **Command Logic**: `src/handlers/commandHandler.js`. Handles the following commands (all defined in `src/constants.js`):
    | Command | Arguments | Purpose |
    |---|---|---|
    | `/stats` | `[N]` (2–100, default 10) | Show stats table for tracked players |
    | `/add_player` | `<nickname>` | Add player to tracking list |
    | `/remove_player` | `<nickname>` | Remove player from tracking list |
    | `/players` | — | List all tracked players |
    | `/help` | — | Show help message |
    | `/subscribe` | `<nickname>` | Subscribe to match-start notifications |
    | `/unsubscribe` | `<nickname>` | Unsubscribe from match-start notifications |
    | `/my_subscriptions` | — | List active subscriptions for this chat |

## Developer Workflows
- **Local Development**: 
    1. Create `.env` with `FACEIT_API_KEY=...`, `TELEGRAM_BOT_TOKEN_TEST=...`, and `GOOGLE_APPLICATION_CREDENTIALS=...` (if needed for Firestore).
    2. Ensure `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` is set in `.env` for Firestore context.
    3. Set `NGROK_APP_ENDPOINT` in `.env` for the ngrok static domain.
    4. Run `npm run dev`. This triggers `predev` (`scripts/set-webhook.js` registers the ngrok URL as the Telegram webhook), then starts ngrok + the server concurrently.
    5. Alternatively, run `node index.js` directly (no webhook registration). The server listens on `PORT` (default 8080).
- **npm Scripts**:
    - `npm start` — Production start (`node index.js`).
    - `npm run dev` — Local dev: runs `set-webhook.js` (predev), then starts ngrok tunnel and `node index.js` concurrently.
- **Request Handling**:
  - `POST /`: Handles Telegram updates (routed to `src/handlers/webhookHandler.js`).
  - `POST /webhook/faceit`: Handles FACEIT match events (routed to `src/handlers/faceitWebhookHandler.js`).
  - `GET /`: Health check (returns 200 OK).
- **Environment**: Node.js 20 (specified in `package.json`).
- **Tech Stack**:
    - **Server**: Express.js (for HTTP handling).
    - **HTTP Client**: Axios (for FACEIT API requests); native `fetch` for the unofficial ELO timeline API.
    - **Database**: Google Cloud Firestore (for per-chat persistence).
    - **Configuration**: `dotenv` (for local secrets management).
    - **Dev tooling**: `concurrently` for running ngrok + server in parallel.
    - **Constants**: `src/constants.js` defines command strings and fixed values.
- **Configuration**:
  - `config.json` in root directory.
    - Note: The `users` array is legacy and ignored by bot commands; use `/add_player`.
  - `src/config.js` consolidates env vars and `config.json`. Reads:
    | Config Key | Env Var | Purpose |
    |---|---|---|
    | `faceit_api_key` | `FACEIT_API_KEY` | FACEIT OpenAPI v4 Bearer token |
    | `telegram_bot_token` | `TELEGRAM_BOT_TOKEN` (prod) or `TELEGRAM_BOT_TOKEN_TEST` (dev) | Bot token |
    | `faceit_webhook_secret` | `FACEIT_WEBHOOK_SECRET` | FACEIT webhook validation (optional) |
    | `projectId` | `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` | GCP project for Firestore |
    | `last_matches` | — | Default N for `/stats` |
  - **Security**: 
    - Use `.env` file for local `FACEIT_API_KEY`, `TELEGRAM_BOT_TOKEN_TEST`, `FACEIT_WEBHOOK_SECRET`.
    - Use Runtime Environment Variables for secrets in Google Cloud Functions.
    - NEVER commit the actual API key to `config.json`.

## Operational Knowledge
- **Error Handling**: Always return `200 OK` to Telegram, even for ignored messages or errors.
- **FACEIT Webhook**: Respond `200` immediately before async processing to prevent FACEIT retries.
- **Logging**: Use `console.log()` for structured logging compatible with Google Cloud Logging.
- **Response Format**: Stats table uses HTML parse mode with fixed-width columns. Match notifications use Telegram Markdown.

## Key Files
- `index.js`: Minimal entry point; dual-mode for local dev and Cloud Functions.
- `src/app.js`: Express app setup with route definitions.
- `src/handlers/webhookHandler.js`: Telegram webhook routing, command parsing, and response dispatch.
- `src/handlers/faceitWebhookHandler.js`: FACEIT webhook handler (validates secret, async event processing).
- `src/handlers/commandHandler.js`: Business logic for all bot commands.
- `src/services/faceitService.js`: CS2 stats logic; FACEIT API client; ELO timeline fetcher.
- `src/services/storageService.js`: Firestore database operations (players, subscriptions, deduplication).
- `src/services/subscriptionService.js`: Match-start event handling and notification dispatch.
- `src/services/telegramService.js`: Telegram Bot API integration for push notifications.
- `src/config.js`: Configuration loader (env vars + config.json).
- `src/constants.js`: Bot command string definitions.
- `config.json`: Master configuration file (default values; no secrets).
- `scripts/set-webhook.js`: Registers ngrok URL as Telegram webhook (runs as `predev`).
- `ai-files/LOCAL_TESTING.md`: Local testing guide (Russian).
- `ai-files/faceit-open-api.json`: OpenAPI 3.0 spec for FACEIT Data API v4.