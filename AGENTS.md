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
- **Entry Point**: `index.js` loads the app from `src/app.js` and starts the server.
- **Webhook Pattern**: The bot uses the [Webhook Reply](https://core.telegram.org/bots/api#making-requests-when-getting-updates) mechanism.
  - **Logic**: Handled in `src/handlers/webhookHandler.js`.
  - **Example**:
    ```javascript
    const replyPayload = {
        method: 'sendMessage',
        chat_id: chatId,
        text: '...',
        parse_mode: 'Markdown'
    };
    res.json(replyPayload);
    ```
- **Stats Module**: `src/services/faceitService.js`. Calculates average stats (ADR, K/D, kills, ELO, ELO change) from the last N matches.
    - **Faceit API**: Uses v4 `/players`, `/players/{id}/games/{game}/stats`, and the unofficial ELO timeline endpoint. Match details fetched via `/matches/{matchId}` as fallback.
    - **Batching**: Processes player lookups in chunks of 10 to manage API rate limits. Game stats and ELO timeline fetched in parallel per player.
- **Storage Module**: `src/services/storageService.js`. Manages per-chat data using Firestore.
    - **Collections**:
        - `chats` — Document ID = `chatId`. Structure: `{ players: ["nickname1", "nickname2"] }`.
        - `player_subscriptions` — Document ID = `playerId`. Structure: `{ playerId, nickname, subscribedChats: [chatIds] }`.
        - `sent_match_notifications` — Document ID = `matchId_chatId`. Used for deduplication.
    - **Requirement**: Firestore database must be created in **Native Mode**.
- **Subscription Module**: `src/services/subscriptionService.js`. Handles match-start event logic triggered by FACEIT webhooks. Queries subscriptions, deduplicates notifications, and dispatches Telegram messages.
- **Telegram Module**: `src/services/telegramService.js`. Sends messages to Telegram chats via Bot API (used for push notifications from FACEIT webhook events).
- **Command Logic**: `src/handlers/commandHandler.js`. Handles `/stats [N]`, `/add_player`, `/remove_player`, `/players`, `/help`, `/subscribe`, `/unsubscribe`, `/my_subscriptions`.
    - **Arguments**: `/stats` accepts an optional count `N` (2-100, default 10).
    - **Constants**: Command strings defined in `src/constants.js`.

## Developer Workflows
- **Local Development**: 
    1. Create `.env` with `FACEIT_API_KEY=...` and `GOOGLE_APPLICATION_CREDENTIALS=...` (if needed for Firestore).
    2. Ensure `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` is set in `.env` for Firestore context.
    3. Run `node index.js`. The server listens on `PORT` (default 8080).
- **Request Handling**:
  - `POST /`: Handles Telegram updates (routed to `src/handlers/webhookHandler.js`).
  - `POST /webhook/faceit`: Handles FACEIT match events (routed to `src/handlers/faceitWebhookHandler.js`).
  - `GET /`: Health check (returns 200 OK).
- **Environment**: Node.js 20 (specified in `package.json`).
- **Tech Stack**:
    - **Server**: Express.js (for HTTP handling).
    - **HTTP Client**: Axios (for FACEIT API requests).
    - **Database**: Google Cloud Firestore (for per-chat persistence).
    - **Configuration**: `dotenv` (for local secrets management).
    - **Constants**: `src/constants.js` defines command strings and fixed values.
- **Configuration**:
  - `config.json` in root directory.
    - Note: The `users` array is legacy and ignored by bot commands; use `/add_player`.
  - `src/config.js` consolidates env vars and `config.json`.
  - **Security**: 
    - Use `.env` file for local `FACEIT_API_KEY`, `TELEGRAM_BOT_TOKEN`, `FACEIT_WEBHOOK_SECRET`.
    - Use Runtime Environment Variables for secrets in Google Cloud Functions.
    - NEVER commit the actual API key to `config.json`.

## Operational Knowledge
- **Error Handling**: Always return `200 OK` to Telegram, even for ignored messages or errors.
- **Logging**: Use `console.log()` for structured logging compatible with Google Cloud Logging.
- **Response Format**: Uses Markdown code blocks for tabular data.

## Key Files
- `index.js`: Minimal entry point.
- `src/app.js`: Express app setup.
- `src/handlers/webhookHandler.js`: Telegram webhook routing and parsing.
- `src/handlers/faceitWebhookHandler.js`: FACEIT webhook handler (validates secret, triggers subscription logic).
- `src/handlers/commandHandler.js`: Business logic for bot commands.
- `src/services/faceitService.js`: CS2 stats logic.
- `src/services/storageService.js`: Firestore database operations.
- `src/services/subscriptionService.js`: Match-start event handling and notification dispatch.
- `src/services/telegramService.js`: Telegram Bot API integration for push notifications.
- `src/config.js`: Configuration loader.
- `src/constants.js`: Bot command definitions.
- `config.json`: Master configuration file.
- `ai-files/`: Directory for AI-related files and implementation plans.