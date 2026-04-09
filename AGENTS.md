# AGENTS.md - Faceit Last 10 Stats Bot

## AI Agent Rules

> These rules are mandatory and must be followed in every session.

1. **Tool priority order.** When solving a task, prefer tools in this order:
   1. Built-in tools (grep, glob, view, edit, create, bash, sql, etc.)
   2. MCP servers (GitHub MCP, etc.)
   3. Ecosystem CLI tools (`npm`, `git`, `gcloud`, etc.)
   4. Custom scripts — use only as a last resort when built-in tools cannot accomplish the task.

2. **Keep AGENTS.md up to date.** After making any changes to the codebase (new files, renamed files, changed architecture, new commands, new env vars, changed workflows, etc.) — update the relevant sections of this file before finishing the task.

## Project Overview
This is a Node.js Telegram bot designed to run as a **Google Cloud Function** (HTTP Trigger). It fetches **FACEIT Data API v4** statistics for **Counter-Strike 2 (CS2)** and communicates with Telegram via **Webhook Replies**.

The stats fetching module is located in `src/services/faceitService.js` and is integrated into the main bot logic.

## Architecture & Core logic
- **Entry Point**: `index.js` loads the app from `src/app.js` and starts the server. Exports `telegramBot` for Google Cloud Functions; listens on `PORT` (default 8080) when run directly. Calls `fetchBotUsername()` and `setMyCommands()` at startup (both from `telegramService.js`).
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
- **Image Module**: `src/services/imageService.js`. Generates FACEIT-styled PNGs using `@napi-rs/canvas`. Exports:
    - `generateStatsImage(leaderboard, matchesCount) → Promise<Buffer>` — stats leaderboard card (720px wide).
    - `generateMatchImage(matchInfo) → Promise<Buffer>` — match notification card (580px wide). Shows team names, ELO, win probability pill, tracked player highlights with orange accent. `matchInfo`: `{ team1, team2, competition, region, bestOf }` where each team is `{ name, elo, winProb, trackedPlayers[] }`.
    - `generateMatchResultImage(data) → Promise<Buffer>` — single-player match result card (540px wide). Shows WIN/LOSE badge with round score (e.g. `16 : 12`), player avatar + nickname + skill level, current ELO + ELO delta, and per-match stats (Kills, Assists, K/D, ADR, HS%). Used by finish notifications for <2000 ELO players. `data`: `{ nickname, avatar_url, skillLevel, currentElo, eloChange, kills, deaths, assists, kd, adr, hsPercent, result, competition, map, teamScore, opponentScore }`. Thin public wrapper around `_drawMatchResultCard`.
    - `generateMatchResultsSummaryImage(playersData) → Promise<Buffer>` — stacks multiple match result cards vertically (10px gap) into a single PNG. Used by `handleMatchFinishedEvent` to send one aggregated image per chat. **Optimised:** all avatars are loaded in parallel, then all cards are drawn directly onto one shared canvas — no intermediate PNG encode/decode. Only one `toBuffer()` call is made regardless of player count.
    - `_drawMatchResultCard(ctx, data, offsetY, avatar)` — private. Draws one result card at the given Y offset on an existing canvas context. Used by both `generateMatchResultImage` and `generateMatchResultsSummaryImage`.
    - `_loadAvatar(url)` — private. Safely loads an avatar image; returns `null` on any error.
    - `generatePlayerCard(player, action) → Promise<Buffer>` — add/remove confirmation card (500px wide).
    - `generatePlayersListImage(players) → Promise<Buffer>` — tracked players list card (540px wide), sorted by ELO descending.
    - **Fonts**: bundled Inter WOFF2 in `src/assets/fonts/` registered via `GlobalFonts` — identical rendering on macOS and Linux.
    - **Design tokens**: colour palette in `imageService.js` is aligned with `public/index.html` CSS variables — `pageBg:#121212`, `bg:#1E1E1E` (`--card`), `headerBg:#2A2A2A` (`--card2`), `separator:rgba(255,255,255,0.07)` (`--divider`), `positive:#52BC6A` (`--green`), `negative:#FF5757` (`--red`). Skill-badge colours (1–10) match the web-app skill-bar segments exactly (grey / green / gold / orange / brand-orange).
    - **Faceit API**: Uses v4 `/players?nickname={nick}&game=cs2`, `/players/{id}/games/cs2/stats?limit={N}`, and the unofficial ELO timeline endpoint `https://api.faceit.com/stats/v1/stats/time/users/{playerId}/games/cs2`. Match details fetched via `/matches/{matchId}` as fallback.
    - **ELO API Note**: The unofficial ELO timeline endpoint is fetched using Node.js native `fetch` (not axios) to bypass Cloudflare protection.
    - **Batching**: Processes player lookups in chunks of 10 to manage API rate limits. For each player, `getPlayerInfoById`, game stats, and ELO timeline are fetched in parallel (3 concurrent requests per player, no sequential nickname→id resolution needed).
    - **Output**: Sorted by ADR descending. Formatted as an HTML-escaped table: `Name | ADR | K/D | Kills | ELO | ±ELO`.
    - **Active Match API**: `enrichMatchWithRosterElos(apiKey, match)` — adds `faceit_elo` and `skill_level` to every roster player. Single-match lookup is handled by `GET /api/match` in `apiHandler.js`.
    - **Additional exports used externally**: `getMatchStats(apiKey, matchId)` — fetches raw match stats `{ rounds: [...] }` from `GET /matches/{id}/stats`; returns `null` for ongoing matches (404). `extractPlayerMatchStats(matchStats, playerId)` — extracts a single player's stats from the raw stats response (returns `{ kills, deaths, assists, kd, adr, hsPercent, result, map, teamScore, opponentScore }`; `teamScore`/`opponentScore` are the final round scores for the player's team and opponent). `getLastMatchEloChange(playerId)` — returns the ELO delta for the player's most recent match from the unofficial timeline. All three are used by `subscriptionService.js` and/or `apiHandler.js`.
    - **Axios client**: Single module-level instance (`getApiClient`) — created once and reused across all FACEIT API calls. Configured with `timeout: 15000` ms.
- **Web App**: `public/index.html`. Telegram Mini App that displays active matches for subscribed players in a chat.
    - Served at `GET /app` (static middleware from `public/`). Not at root `/`.
    - Reads `?chatId=` and optional `?matchId=` URL params (or Telegram `start_param` `{chatId}_{matchId}`).
    - Fetches `GET /api/active-matches?chatId=…` and renders each match with full team rosters, ELO badges, skill level icons, live score (if `ONGOING`), and tracked-player highlights.
    - Tracked players shown in green; teams colour-coded blue/red.
    - Shows a 🔄 Refresh button.
- **REST API Handler**: `src/handlers/apiHandler.js`. Serves `GET /api/active-matches?chatId=<id>` and `GET /api/match?matchId=<id>&chatId=<id>`.
    - Active matches response: JSON `{ matches: [...] }` — one entry per unique active match.
    - Each match includes `matchId`, `status`, `competition_name`, `region`, `best_of`, `results` (score), `mapInfo` (`{ name, image }` from voting data, nullable), `teams` (both rosters with ELO), `trackedPlayers`, `matchUrl`.
    - Single match (`GET /api/match`): JSON `{ match: {...} }` — same shape plus `matchStats: { maps, players }` when FACEIT stats are available. `players` is keyed by `player_id` with `{ nickname, faction, kills, deaths, assists, kd, adr, hs_pct, isTracked, avatar }`.
    - `processMatchStats(statsData, faction1Id, faction2Id)` — local helper that aggregates per-player stats across maps and extracts map scores (used by `getMatch`).
    - Match ID sources for active-matches are delegated to `src/services/matchService.js`.
- **Storage Module**: `src/services/storageService.js`. Manages per-chat data using Firestore.
    - **Collections**:
        - `chats` — Document ID = `chatId`. Structure: `{ name: "Chat Name", players: [{ id: "faceit-uuid", nickname: "s1mple" }] }`.
        - `player_subscriptions` — Document ID = `playerId` (FACEIT GUID). Structure: `{ playerId, nickname, subscribedChats: [chatIds] }`.
        - `sent_match_notifications` — Three dedup variants:
            - Start: `{matchId}_{chatId}` — Fields: `matchId`, `chatId`, `playerIds[]`, `sentAt`, `expireAt` (sentAt + 7 дней, используется для нативного TTL). `playerIds` enables cross-chat match lookup via `getRecentMatchIdsForPlayers`.
            - Finish (chat-level): `{matchId}_{chatId}_finish` — Fields: `matchId`, `chatId`, `playerIds[]`, `type: 'finish_chat'`, `sentAt`, `expireAt` (sentAt + 7 дней).
            - Finish (per-player, legacy): `{matchId}_{chatId}_{playerId}_finish` — Fields: `matchId`, `chatId`, `playerId`, `type: 'finish'`, `sentAt`.
            - **TTL**: Нативный Firestore TTL настроен на поле `expireAt`. Документы автоматически удаляются через 7 дней. Для (пере-)создания политики: `gcloud firestore fields ttls update expireAt --collection-group=sent_match_notifications --enable-ttl --project=<GCLOUD_PROJECT>`.
        - `active_matches` — Document ID = `{chatId}_{matchId}`. Structure: `{ chatId, matchId, startedAt }`. Written when a match-start notification is sent; deleted when the match finishes/is cancelled. Functions: `storeActiveMatch`, `getActiveMatchIds`, `removeActiveMatch`.
    - **Deduplication (race-condition safe)**: `markNotificationSent` and `markFinishNotificationSentForChat` use Firestore `create()` (atomic) instead of `set()`. Returns `true` if the document was newly created (proceed with sending), `false` if it already existed (`ALREADY_EXISTS`, code `6` — skip silently). This prevents duplicate notifications when parallel GCF instances handle the same webhook event.
    - **Key function**: `getRecentMatchIdsForPlayers(playerIds, sinceTs)` — searches `sent_match_notifications` (where `playerIds` array-contains a tracked player) within a 6-hour window. Used by `matchService` as a cross-chat fallback to find active matches.
    - **Requirement**: Firestore database must be created in **Native Mode**.
- **Subscription Module**: `src/services/subscriptionService.js`. Handles match-start and match-finish event logic triggered by FACEIT webhooks. Queries subscriptions, deduplicates notifications, and dispatches Telegram messages. Subscription management (subscribe/unsubscribe) is handled automatically by `add_player`/`remove_player` commands via `storageService.subscribeChat` / `storageService.unsubscribeChat`.
    - **Supported Events**: `match_status_ready` (match start) and `match_status_finished` (match end).
    - **Match Start** (`handleMatchEvent`): sends a match card image to all subscribed chats with team rosters, ELO, win probability. Also calls `storeActiveMatch(chatId, matchId)`.
    - **Match Finish** (`handleMatchFinishedEvent`): for each subscribed chat, fetches current ELO and match stats for all tracked players, then sends ONE aggregated image (`generateMatchResultsSummaryImage`) stacking per-player result cards vertically. Caption contains funny lines (from `getRandomFunnyMessage`) for players with ELO < 2000. Deduplication key: `${matchId}_${chatId}_finish` (chat-level). Also calls `removeActiveMatch`.
    - **Web App Button**: If `WEBAPP_URL` env var is set, both start and finish notifications include an inline button. **Groups** (negative chat ID + `BOT_USERNAME` set): `url` button → `https://t.me/{bot_username}?startapp={chatId}_{matchId}&mode=compact`. **Private chats**: `web_app` type button → `{WEBAPP_URL}?chatId={chatId}&matchId={matchId}`.
    - **FACEIT Webhook Handler**: `src/handlers/faceitWebhookHandler.js` validates the `x-faceit-webhook-secret` header (**always required** — returns `403` if `FACEIT_WEBHOOK_SECRET` is not configured, `401` if the header doesn't match), responds `200` immediately, then processes the event asynchronously via `handleMatchEvent()` or `handleMatchFinishedEvent()`.
- **Telegram Module**: `src/services/telegramService.js`. Sends messages to Telegram chats via Bot API (used for push notifications from FACEIT webhook events, not the webhook reply mechanism). Exports:
    - `sendMessage(chatId, text, replyMarkup?, options?)` — sends text. `options.parseMode` defaults to `'Markdown'`; `options.disableWebPagePreview` defaults to `true`.
    - `sendPhoto(chatId, imageBuffer, caption?, replyMarkup?)` — multipart/form-data upload; caption always uses `HTML` parse mode.
    - `fetchBotUsername()` — calls Telegram `getMe` API and stores result in `config.bot_username`. Called at startup from `index.js`.
    - `setMyCommands()` — registers `BOT_COMMANDS` with Telegram `setMyCommands` API so the `/` menu stays up to date. Called at startup from `index.js`.
- **Command Logic**: `src/handlers/commandHandler.js`. Handles the following commands (all defined in `src/commands.js`). Handlers that send responses directly (e.g. `sendPhoto` for `/stats`) return `null`; `webhookHandler` sends `200` without a reply body in that case.
    - **ForceReply pattern**: When a handler needs a missing argument (e.g. `/add_player` with no nickname), it returns `{ type: 'force_reply', prompt, placeholder }`. `webhookHandler` then sends a `force_reply` markup in private chats, or a usage hint `<code>/command placeholder</code>` in groups (where bots in privacy mode can't receive plain replies). `COMMAND_LIST` entries support optional `prompt` and `placeholder` fields to enable this behaviour — add both when creating a command that requires an argument.
    - **Player limit**: `handleAddPlayer` checks the current player count against `MAX_PLAYERS_PER_CHAT` (20) **before** calling the FACEIT API. Returns an error message if the limit is reached.
    - **`web_app` result type**: `handleLive` returns `{ type: 'web_app', text, url, parse_mode }`. `webhookHandler` sends a `web_app` button in private chats and a `url` t.me link in groups.
    | Command | Arguments | Purpose |
    |---|---|---|
    | `/stats` | `[N]` (2–100, default 10) | Show stats image for tracked players |
    | `/add_player` | `<nickname>` | Add player to tracking list and subscribe to match notifications |
    | `/remove_player` | `<nickname>` | Remove player from tracking list and unsubscribe from notifications |
    | `/players` | — | List all tracked players |
    | `/help` | — | Show help message |
    | `/live` | — | Открыть Mini App с активными матчами (требует `WEBAPP_URL`) |

## Developer Workflows
- **Local Development**: 
    1. Create `.env` with `FACEIT_API_KEY=...`, `TELEGRAM_BOT_TOKEN=...`, and `GOOGLE_APPLICATION_CREDENTIALS=...` (if needed for Firestore).
    2. Ensure `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` is set in `.env` for Firestore context.
    3. Run `npm run dev` — starts ngrok + the server concurrently.
    4. If the webhook URL ever changes, run `npm run set-webhook` once manually.
- **npm Scripts**:
    - `npm start` — Production start (`node index.js`).
    - `npm test` — Run all tests with Jest.
    - `npm run test:watch` — Run tests in watch mode (re-runs on file change).
    - `npm run test:coverage` — Run tests and generate an HTML/lcov coverage report in `coverage/`.
    - `npm run dev` — Local dev: starts ngrok tunnel and `node index.js` concurrently. **Note**: the ngrok URL is hardcoded in `package.json` as a static domain (`huddlingly-shirty-chantal.ngrok-free.dev`) — requires a paid ngrok plan or a configured free static domain. Update this URL if the ngrok domain changes.
    - `npm run test-notify -- --nickname <nick> --chatId <chatId>` — Simulate a FACEIT **match start** notification locally (see `scripts/test-notify.js`).
    - `npm run test-notify-finish -- --nickname <nick> --chatId <chatId>` — Simulate a FACEIT **match finish** notification locally (see `scripts/test-notify-finish.js`). Add `--force` to bypass Firestore subscriptions and send the result card directly via Telegram API. Add `--matchId <id>` to use a specific match.
- **Request Handling**:
  - `POST /`: Handles Telegram updates (routed to `src/handlers/webhookHandler.js`).
  - `POST /webhook/faceit`: Handles FACEIT match events (routed to `src/handlers/faceitWebhookHandler.js`).
  - `GET /api/active-matches?chatId=<id>`: REST endpoint for active matches (routed to `src/handlers/apiHandler.js`).
  - `GET /app` (and `/app/*` static): Serves web app from `public/` directory.
  - `GET /health`: Health check (returns `200 OK`). Используй этот путь в настройках GCF/Cloud Run.
- **Environment**: Node.js 20 (specified in `package.json`).
- **Tech Stack**:
    - **Server**: Express.js (for HTTP handling).
    - **HTTP Client**: Axios (for FACEIT API requests); native `fetch` for the unofficial ELO timeline API.
    - **Database**: Google Cloud Firestore (for per-chat persistence).
    - **Configuration**: `dotenv` (for local secrets management).
    - **Dev tooling**: `concurrently` for running ngrok + server in parallel.
    - **Constants**: `src/commands.js` is the single source of truth for all commands (`COMMAND_LIST`, `COMMANDS`, `BOT_COMMANDS`). `src/constants.js` holds shared runtime constants (`FINISHED_STATUSES`, `MATCH_URL_BASE`, `MATCH_STATUS_LABELS`). `src/utils.js` holds shared utility functions (`escapeHtml`).
- **Configuration**:
  - `config.json` in root directory.
    - Note: The `users` array is legacy and ignored by bot commands; use `/add_player`.
  - `src/config.js` consolidates env vars and `config.json`. Reads:
    | Config Key | Env Var | Purpose |
    |---|---|---|
    | `faceit_api_key` | `FACEIT_API_KEY` | FACEIT OpenAPI v4 Bearer token |
    | `telegram_bot_token` | `TELEGRAM_BOT_TOKEN` | Bot token |
    | `faceit_webhook_secret` | `FACEIT_WEBHOOK_SECRET` | FACEIT webhook validation (**required** — requests without it are rejected with 403) |
    | `projectId` | `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` | GCP project for Firestore |
    | `webapp_url` | `WEBAPP_URL` | Public HTTPS URL of the web app (e.g. `https://…/app`). Enables Mini App button in match notifications. |
    | `bot_username` | `BOT_USERNAME` | Telegram bot username (without `@`). Auto-populated at startup via `fetchBotUsername()` (`getMe` API). Required for group-chat Mini App `t.me` links. |
    | `last_matches` | — | Default N for `/stats` |
  - **Security**: 
    - Use `.env` file for local `FACEIT_API_KEY`, `TELEGRAM_BOT_TOKEN`, `FACEIT_WEBHOOK_SECRET`.
    - Use Runtime Environment Variables for secrets in Google Cloud Functions.
    - NEVER commit the actual API key to `config.json`.

## Operational Knowledge
- **Error Handling**: Always return `200 OK` to Telegram, even for ignored messages or errors.
- **FACEIT Webhook**: Respond `200` immediately before async processing to prevent FACEIT retries.
- **Logging**: Use `console.log()` for structured logging compatible with Google Cloud Logging.
- **Response Format**: Stats table uses HTML parse mode with fixed-width columns. Match notifications use Telegram Markdown.

## Key Files
- `index.js`: Minimal entry point; dual-mode for local dev and Cloud Functions.
- `src/app.js`: Express app setup with route definitions and static file serving from `public/`.
- `src/handlers/webhookHandler.js`: Telegram webhook routing, command parsing, and response dispatch.
- `src/handlers/faceitWebhookHandler.js`: FACEIT webhook handler (validates secret, async event processing).
- `src/handlers/commandHandler.js`: Business logic for all bot commands.
- `src/handlers/apiHandler.js`: REST handlers for `GET /api/active-matches` and `GET /api/match` — returns active/single match data. Shared `formatMatchResponse()` helper eliminates duplication.
- `src/services/matchService.js`: Collects and filters active match IDs for a chat. Exports:
    - `collectMatchIds(chatId, trackedPlayerIds)` — merges IDs from `active_matches` collection and `sent_match_notifications` cross-chat fallback (6-hour window).
    - `fetchActiveMatchDetails(chatId, matchIds, apiKey, trackedPlayerIds)` — fetches match details, filters out finished ones (and removes them from `active_matches` storage), optionally filters by tracked player membership.
- `src/services/imageService.js`: Generates FACEIT-styled PNGs using `@napi-rs/canvas`. See Image Module section for full export list.
- `src/services/storageService.js`: Firestore database operations (players, subscriptions, deduplication).
- `src/services/subscriptionService.js`: Match-start and match-finish event handling and notification dispatch. `handleMatchEvent` for start, `handleMatchFinishedEvent` for finish (aggregated per-chat image via `generateMatchResultsSummaryImage`).
- `src/data/matchFinishMessages.js`: **Message pools for finish notifications.** 30 funny messages for <2000 ELO players (`getRandomFunnyMessage(nickname, currentElo)`). Includes estimated wins to level 10 (ELO left / 25).
- `src/services/telegramService.js`: Telegram Bot API integration for push notifications. `sendMessage(chatId, text, replyMarkup?)` supports optional inline keyboards. `sendPhoto(chatId, imageBuffer, caption?)` sends a PNG via multipart/form-data. Also exports `fetchBotUsername()` and `setMyCommands()` (both called at startup from `index.js`).
- `src/config.js`: Configuration loader (env vars + config.json).
- `src/commands.js`: **Единый реестр команд.** Экспортирует `COMMAND_LIST` (полные описания), `COMMANDS` (словарь строк), `BOT_COMMANDS` (для `setMyCommands` API). Единственное место для добавления новых команд.
- `src/constants.js`: Shared runtime constants — `FINISHED_STATUSES`, `MATCH_URL_BASE`, `MATCH_STATUS_LABELS`, `MAX_PLAYERS_PER_CHAT` (= 20).
- `src/utils.js`: Shared utility functions — `escapeHtml`.
- `public/index.html`: Telegram Mini App web page — shows active matches with rosters, ELO, and live scores.
- `config.json`: Master configuration file (default values; no secrets).
- `scripts/` — development utilities:
    - `scripts/set-webhook.js`: Registers the Telegram webhook URL (run once when URL changes, via `npm run set-webhook`).
    - `scripts/backfill-notification-playerids.js`: One-time migration — fills missing `playerIds` field in old `sent_match_notifications` docs. Run locally: `node scripts/backfill-notification-playerids.js`.
- `scripts/test-notify.js`: **Dev-only test script.** Simulates a `match_status_ready` FACEIT webhook for a given player. Fetches the player's most recent match from FACEIT API and POSTs it to the local bot. Usage: `npm run test-notify -- --nickname <nick> --chatId <chatId> [--port 8080] [--secret <secret>]`.
- `ai-files/LOCAL_TESTING.md`: Local testing guide (Russian).
- `ai-files/faceit-open-api.json`: OpenAPI 3.0 spec for FACEIT Data API v4.

## Automated Testing

- **Framework**: Jest 29 (CJS, Node 20).
- **Structure**: `tests/unit/` — pure/logic tests; `tests/integration/` — handler tests with mocked deps.
- **Mock strategy**: external services (`faceitService`, `storageService`, `telegramService`, `imageService`, `subscriptionService`, `matchService`) are fully mocked via `jest.mock()`. No real network/DB calls.
- **Commands**: `npm test` | `npm run test:watch` | `npm run test:coverage`.
- **Coverage report**: `coverage/` (HTML + lcov). Core handlers sit at ~97% statement coverage; external services (FACEIT API, Firestore, Telegram, Canvas) are mocked and intentionally not unit-tested.

### Test files

| File | What it covers |
|---|---|
| `tests/unit/utils.test.js` | `escapeHtml` — all HTML entity replacements, non-string input |
| `tests/unit/constants.test.js` | `FINISHED_STATUSES`, `MATCH_URL_BASE`, `MATCH_STATUS_LABELS` shape |
| `tests/unit/commands.test.js` | `COMMAND_LIST` structure, `COMMANDS` map, `BOT_COMMANDS` derivation |
| `tests/unit/matchFinishMessages.test.js` | `getRandomFunnyMessage` — placeholder replacement, edge ELO cases |
| `tests/unit/extractPlayerMatchStats.test.js` | `extractPlayerMatchStats` — null/empty input, stats extraction for both teams, `teamScore`/`opponentScore` (win/lose, missing scores, lower-case fallback, missing opponent team) |
| `tests/unit/processMatchStats.test.js` | `processMatchStats` — null input, single map, multi-map accumulation, K/D & HS% edge cases |
| `tests/unit/matchService.test.js` | `collectMatchIds` dedup logic; `fetchActiveMatchDetails` filtering & Firestore cleanup |
| `tests/unit/storageService.test.js` | `markNotificationSent` / `markFinishNotificationSentForChat` — atomic `create()` contract: returns `true` on success, `false` on `ALREADY_EXISTS` (code 6), rethrows other errors; `expireAt` TTL field (7 days ±5 s); regression `getRecentMatchIdsForPlayers` with `expireAt` field in docs |
| `tests/integration/commandHandler.test.js` | All 6 commands: happy paths, error messages, `force_reply`, `web_app` result |
| `tests/integration/webhookHandler.test.js` | Telegram webhook routing: ignoring invalid updates, `@botname` stripping, ForceReply detection, group vs private response shapes |
| `tests/integration/faceitWebhookHandler.test.js` | Secret validation (401), unsupported events, `match_status_ready` / `match_status_finished` dispatch, fire-and-forget error swallowing |
| `tests/integration/apiHandler.test.js` | `GET /api/active-matches` and `GET /api/match` — 400/404/500 errors, success shapes, tracked-player marking, `matchStats` enrichment |

### Known bug fixed by tests
- `src/data/matchFinishMessages.js` referenced `ELO_PER_WIN` without defining it → added `const ELO_PER_WIN = 25;` (caught by `matchFinishMessages.test.js`).
