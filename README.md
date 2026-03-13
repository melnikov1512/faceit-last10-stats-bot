# Faceit Last 10 Stats Bot

A Node.js Telegram bot designed to be deployed as a **Google Cloud Function** (HTTP Trigger). It fetches **FACEIT Data API v4** statistics for **Counter-Strike 2 (CS2)** and communicates with Telegram via **Webhook Replies**.

## Features

- **Get Stats**: Fetch average stats (K/D, ADR, Average Kills) for the last N matches (default 10).
- **Player Management**: Add or remove players to track per chat.
- **Batched Processing**: Efficiently fetches stats for multiple players respecting API rate limits.
- **Persistence**: Uses Google Cloud Firestore (Native Mode) to store tracked players for each chat.

## Commands

- `/stats [N]` - Get stats for the last N matches (default 10, range 2-100).
- `/add_player <nickname>` - Add a player to the tracking list for the current chat.
- `/remove_player <nickname>` - Remove a player from the tracking list.
- `/players` - List all tracked players in the current chat.
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

## Configuration

Duplicate the `.env.example` (or create a new `.env` file) and fill in your details:

```env
FACEIT_API_KEY=your_faceit_api_key_here
GCLOUD_PROJECT=your_google_cloud_project_id
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

## Project Structure

- `index.js`: Entry point. Starts the Express server if run directly, or exports `telegramBot` for GCF.
- `src/app.js`: Express app setup and middleware.
- `src/handlers/webhookHandler.js`: Handles incoming Telegram updates.
- `src/handlers/commandHandler.js`: Contains business logic for bot commands.
- `src/services/faceitService.js`: Logic for fetching and calculating CS2 stats from FACEIT API.
- `src/services/storageService.js`: Firestore database operations for player management.
- `src/config.js`: Configuration loader (merges `.env` and `config.json`).
- `src/constants.js`: Bot command definitions.
