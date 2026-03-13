# AGENTS.md - Faceit Last 10 Stats Bot

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
- **Stats Module**: `src/services/faceitService.js`. Calculates average stats (ADR, K/D) from the last N matches.
    - **Faceit API**: Uses v4 `/players` and `/players/{id}/games/{game}/stats` endpoints.
    - **Batching**: Processes player lookups in chunks to respect API limits (3 players concurrent). Fetches stats for all requested matches in a single call per player.
- **Storage Module**: `src/services/storageService.js`. Manages per-chat player lists using Firestore.
    - **Schema**: Collection `chats`, Document ID = `chatId`.
    - **Structure**: `{ players: ["nickname1", "nickname2"] }`.
    - **Requirement**: Firestore database must be created in **Native Mode**.
- **Command Logic**: `src/handlers/commandHandler.js`. Handles `/stats [N]`, `/add_player`, `/remove_player`, `/players`, `/help`.
    - **Arguments**: `/stats` accepts an optional count `N` (2-30, default 10).
    - **Constants**: Command strings defined in `src/constants.js`.

## Developer Workflows
- **Local Development**: 
    1. Create `.env` with `FACEIT_API_KEY=...` and `GOOGLE_APPLICATION_CREDENTIALS=...` (if needed for Firestore).
    2. Ensure `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` is set in `.env` for Firestore context.
    3. Run `node index.js`. The server listens on `PORT` (default 8080).
- **Request Handling**:
  - `POST /`: Handles Telegram updates (routed to `src/handlers/webhookHandler.js`).
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
    - Use `.env` file for local `FACEIT_API_KEY`.
    - Use Runtime Environment Variables for `FACEIT_API_KEY` in Google Cloud Functions.
    - NEVER commit the actual API key to `config.json`.

## Operational Knowledge
- **Error Handling**: Always return `200 OK` to Telegram, even for ignored messages or errors.
- **Logging**: Use `console.log()` for structured logging compatible with Google Cloud Logging.
- **Response Format**: Uses Markdown code blocks for tabular data.

## Key Files
- `index.js`: Minimal entry point.
- `src/app.js`: Express app setup.
- `src/handlers/webhookHandler.js`: Webhook routing and parsing.
- `src/handlers/commandHandler.js`: Business logic for bot commands.
- `src/services/faceitService.js`: CS2 stats logic.
- `src/services/storageService.js`: Firestore database operations.
- `src/config.js`: Configuration loader.
- `src/constants.js`: Bot command definitions.
- `config.json`: Master configuration file.
- `ai-implementation-plans/`: Directory for AI-generated implementation plans.