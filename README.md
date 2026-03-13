# faceit-last10-stats-bot

A Telegram bot that fetches CS2 stats from FACEIT for the last 10 matches.

## Prerequisites

1.  **Google Cloud Project**: You need a Google Cloud Project with the Firestore API enabled.
2.  **Firestore Database**: You must create a Firestore database in **Native Mode**.
    *   Go to the [Google Cloud Console](https://console.cloud.google.com/firestore).
    *   Select your project.
    *   Click "Create Database".
    *   Choose **Native Mode**.
    *   Select a location (e.g., `us-central1`).
3.  **FACEIT API Key**: Create an application on the [FACEIT Developer Portal](https://developers.faceit.com/) to get an API key.

## Configuration

Duplicate `.env` and fill in your details:

```env
FACEIT_API_KEY=your_faceit_api_key_here
GCLOUD_PROJECT=your_google_cloud_project_id
```

## Running Locally

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Start the server:
    ```bash
    node index.js
    ```