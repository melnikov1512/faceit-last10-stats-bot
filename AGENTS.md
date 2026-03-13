# AGENTS.md - Faceit Last 10 Stats Bot

## Project Overview
This is a Node.js Telegram bot designed to run as a **Google Cloud Function** (HTTP Trigger). It fetches **FACEIT Data API v4** statistics for **Counter-Strike 2 (CS2)** and communicates with Telegram via **Webhook Replies**.

The stats fetching module is located in `faceit/` and is integrated into the main bot logic.

## Architecture & Core logic
- **Entry Point**: `index.js` serves as both the local Express server and the Cloud Function handler.
- **Webhook Pattern**: The bot uses the [Webhook Reply](https://core.telegram.org/bots/api#making-requests-when-getting-updates) mechanism. Instead of making a separate HTTP request to the Telegram API to send a message, it returns a JSON object in the HTTP response to the webhook update.
  - **Why**: Reduces latency and execution time/cost in a serverless environment (Google Cloud Functions).
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
- **Stats Module**: Located in `faceit/stats.js`. Calculates average stats (ADR, K/D) from the last N matches for **CS2** as configured in `config.json`.
  - **Data Fetching**: Uses `processInChunks` helper to batch API requests and respect rate limits.
  - **Integration**: Imported into `index.js` via `getLeaderboardStats`.
  - **Configuration**: Uses `FACEIT_API_KEY` environment variable (preferred) or `faceit_api_key` from `config.json` as fallback.

## Developer Workflows
- **Local Development**: Run `node index.js`. The server listens on `PORT` (default 8080).
- **Request Handling**:
  - `POST /`: Handles Telegram updates. Specifically listens for `/stats` command.
  - `GET /`: Health check (returns 200 OK).
- **Environment**: Node.js 20 (specified in `package.json`).
- **Configuration**:
  - Requires `config.json` in root directory for user list and settings.
  - `config.json` structure: `users` (array of FACEIT nicknames), `last_matches` (number). `faceit_api_key` can be left empty if using environment variables.
  - **Security**: 
    - Use `.env` file for local `FACEIT_API_KEY`.
    - Use Runtime Environment Variables for `FACEIT_API_KEY` in Google Cloud Functions.
    - NEVER commit the actual API key to `config.json`.
  - Note: `axios` is now a root dependency (used by `faceit/stats.js`).

## Operational Knowledge
- **Error Handling**: Always return `200 OK` to Telegram, even for ignored messages or errors. Failing to do so causes Telegram to retry sending the update, potentially leading to infinite loops or log spam.
- **Logging**: Use `console.log()` for structured logging compatible with Google Cloud Logging.
- **Response Format**: Uses Markdown code blocks for tabular data (monospaced font needed for alignment).
- **Dependencies**: `express` is used for routing and parsing JSON. `axios` is used by the stats module for API requests. `dotenv` is available for environment configuration (if needed).

## Key Files
- `index.js`: Contains all logic: webhook parsing, command routing (`/stats`), and response generation.
- `package.json`: Defines the entry point and runtime engine (Node 20).
- `faceit/stats.js`: Core stats logic (CS2, API v4). Exports `getLeaderboardStats` which manages concurrency.
- `config.json`: Master configuration file (API key, user list, settings).