# Faceit Last 10 Stats Bot

A Node.js Telegram bot designed to be deployed as a **Google Cloud Function** (HTTP Trigger). It fetches **FACEIT Data API v4** statistics for **Counter-Strike 2 (CS2)** and communicates with Telegram via **Webhook Replies**.

## Features

- **Get Stats**: Fetch average stats (K/D, ADR, Average Kills, current ELO, and ELO change) for the last N matches (default 10).
- **ELO Tracking**: Displays each player's current ELO rating and how much it changed over the selected number of matches (e.g. `+63` or `-115`).
- **Player Management**: Add or remove players to track per chat.
- **Batched Processing**: Efficiently fetches stats for multiple players respecting API rate limits.
- **Persistence**: Uses Google Cloud Firestore (Native Mode) to store tracked players for each chat.
- **Match Notifications**: Subscribe to real-time match-start notifications for specific players via FACEIT Webhooks. Multiple subscribed players in the same match produce a single grouped notification.

## Commands

- `/stats [N]` - Get stats for the last N matches (default 10, range 2-100).
- `/add_player <nickname>` - Add a player to the tracking list for the current chat.
- `/remove_player <nickname>` - Remove a player from the tracking list.
- `/players` - List all tracked players in the current chat.
- `/subscribe <nickname>` - Subscribe the current chat to match-start notifications for a player.
- `/unsubscribe <nickname>` - Unsubscribe from a player's notifications.
- `/my_subscriptions` - List all active player subscriptions in the current chat.
- `/help` - Show the help message.

## Prerequisites

1.  **Node.js**: Version 20 or higher.
2.  **Google Cloud Project**: You need a Google Cloud Project with the **Firestore API** enabled.
3.  **Firestore Database**: You must create a Firestore database in **Native Mode**.
    - Go to the [Google Cloud Console > Firestore](https://console.cloud.google.com/firestore).
    - Click "Create Database".
    - Choose **Native Mode**.
    - Select a location (e.g., `us-central1`).
4.  **FACEIT API Key**: Create an application on the [FACEIT Developer Portal](https://developers.faceit.com/) to get an API key.
5.  **Telegram Bot Token**: Obtain from [@BotFather](https://t.me/botfather) — required for async match notifications.

## Configuration

Duplicate the `.env.example` (or create a new `.env` file) and fill in your details:

```env
FACEIT_API_KEY=your_faceit_api_key_here
GCLOUD_PROJECT=your_google_cloud_project_id
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
FACEIT_WEBHOOK_SECRET=your_webhook_secret
# GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json (Only needed for local dev if not using gcloud auth)
```

**Note**: `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` is required for Firestore context.

## Running Locally

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Set Environment Variables**:
    Ensure your `.env` file is configured properly.

3.  **Start the Server**:
    ```bash
    npm start
    ```
    The server will start on port 8080 (default).

4.  **Test Webhooks**:
    You can use tools like `ngrok` to expose your local server to Telegram, or send manual POST requests to `http://localhost:8080/`.

## Deployment (Google Cloud Functions)

This bot is designed to be deployed as a Google Cloud Function (2nd Gen recommended).

1.  **Region**: Choose the same region as your Firestore database if possible.
2.  **Trigger**: HTTP.
3.  **Runtime**: Node.js 20.
4.  **Entry Point**: `telegramBot` (Exported in `index.js`).
5.  **Environment Variables**: Set `FACEIT_API_KEY`, `TELEGRAM_BOT_TOKEN`, `FACEIT_WEBHOOK_SECRET`, and `GCLOUD_PROJECT` in the Cloud Function's runtime environment variables.

## Setting Up FACEIT Webhooks (Match Notifications)

Match notifications use FACEIT's webhook system. This is a one-time setup in the [FACEIT Developer Portal](https://developers.faceit.com/).

1. Go to **App Studio → Webhooks → Create Subscription**.
2. Set **Subscription Type** to **User** → *Static list of other users*.
3. Add the FACEIT player GUIDs you want to track. When a user runs `/subscribe <nickname>`, the bot logs the player's GUID — check your Cloud Function logs to find it.
4. Select event: **`match_object_created`**.
5. Set **Callback URL** to: `https://<your-cloud-function-url>/webhook/faceit`
6. Set **Security Header**:
   - Name: `X-Faceit-Webhook-Secret`
   - Value: the value you configured in `FACEIT_WEBHOOK_SECRET`

> **Important**: When a user subscribes to a new player via `/subscribe`, you must also manually add that player's FACEIT GUID to the App Studio webhook subscription. The bot will log the GUID for you.

### How grouping works

The `match_object_created` payload includes all 10 players in the match. The bot checks every player in the roster against Firestore subscriptions. If a chat has multiple subscribed players in the same match, it receives **one** notification listing all of them.

## Project Structure

- `index.js`: Entry point. Starts the Express server if run directly, or exports `telegramBot` for GCF.
- `src/app.js`: Express app setup and middleware.
- `src/handlers/webhookHandler.js`: Handles incoming Telegram updates.
- `src/handlers/faceitWebhookHandler.js`: Handles incoming FACEIT webhook events.
- `src/handlers/commandHandler.js`: Contains business logic for bot commands.
- `src/services/faceitService.js`: Logic for fetching and calculating CS2 stats from FACEIT API.
- `src/services/storageService.js`: Firestore database operations for player management and subscriptions.
- `src/services/subscriptionService.js`: Subscribe/unsubscribe logic and match event processing.
- `src/services/telegramService.js`: Direct Telegram Bot API calls for async notifications.
- `src/config.js`: Configuration loader (merges `.env` and `config.json`).
- `src/constants.js`: Bot command definitions.
