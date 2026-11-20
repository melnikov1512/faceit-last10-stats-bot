# AGENTS.md — FACEIT Last 10 Stats Bot

## Working rules

- Prefer built-in tools, then MCP tools, then ecosystem CLIs. Use custom scripts as a last resort.
- Do not commit or push without an explicit request. Verify URLs before presenting them as live.
- Write code comments and project documentation in English. Save explicitly requested plans as `docs/plans/<plan-name>/<plan-name>.md`.
- Update this file when a working rule, key runtime contract, or primary entry point changes. Check [README.md](README.md) when changing configuration, workflows, scripts, or project structure.
- Write Node.js scripts in CommonJS, use `node:` for built-in modules, and prefer `parseArgs` for command-line arguments.
- Keep credentials in local `.env` or the deployed runtime environment. Keep real credentials out of `config.json` and version control.
- User requests and higher-priority instructions govern implementation and approvals.

## Project map

Node.js 20 Telegram bot for Counter-Strike 2. It uses Express, FACEIT Data API v4, and Firestore in Native Mode. [README.md](README.md) covers setup, bot commands, environment variables, npm scripts, routes, and deployment.

| Area | Entry points |
| --- | --- |
| Runtime | `index.js` exports `telegramBot` for Cloud Functions, starts Express when run directly, and initializes the Telegram bot username and command menu. Routes live in `src/app.js`. |
| Telegram commands | `src/commands.js` defines the commands, `src/handlers/webhookHandler.js` accepts Telegram updates at `POST /`, and `src/handlers/commandHandler.js` implements the commands. |
| FACEIT events | `src/handlers/faceitWebhookHandler.js` accepts `POST /webhook/faceit`. `src/services/subscriptionService.js` dispatches match notifications through `src/services/telegramService.js`. |
| Storage | `src/services/storageService.js` manages tracked players, subscriptions, active matches, and notification deduplication in Firestore. |
| Stats and cards | `src/services/faceitService.js` fetches stats and ELO. `src/services/ratingEstimator.js` estimates Rating. `src/services/imageService.js` renders PNG cards. `src/services/statsCache.js` caches command images. |
| Mini App | `public/index.html` is served at `/app`. `src/handlers/apiHandler.js` serves `GET /api/active-matches` and `GET /api/match`, with active-match discovery in `src/services/matchService.js`. |
| Configuration | `src/config.js` loads environment variables and defaults from `config.json`. Tracked players are managed per chat through bot commands. |

## Runtime contracts

### Telegram commands

- Register commands in `src/commands.js`. It is the source for dispatch and Telegram's command menu. For a required argument, set both `prompt` and `placeholder` if the handler returns `force_reply`.
- Use Telegram webhook replies with HTML parse mode for text command responses. A handler that sends its own response through the Bot API returns `null` so the webhook can acknowledge it with an empty HTTP 200. Acknowledge ignored updates and handled errors with HTTP 200.
- Use ForceReply in private chats and a usage hint in groups. For Mini App buttons, use `web_app` in private chats and a Telegram deep link in groups.
- Check the per-chat player limit before making the FACEIT lookup for `/add_player`. Keep tracking and notification subscriptions in sync on add and remove.
- Check the `/stats` and `/activity` image cache before Firestore or FACEIT calls. Invalidate both cache prefixes (`<chatId>:` and `activity:<chatId>:`) when the roster changes or Telegram chat cleanup runs.

### FACEIT events and Firestore

- Require `FACEIT_WEBHOOK_SECRET` for `/webhook/faceit`. Return 403 when server configuration is missing and 401 when the `x-faceit-webhook-secret` header fails validation. Acknowledge valid requests with HTTP 200 before processing ready or finished events.
- Keep notification deduplication atomic across instances by using Firestore `create()`. The start and finish notifications each have a chat-level key. Treat an already existing document as a duplicate. New deduplication records use the `expireAt` TTL field.
- Store the Telegram message ID with the active match when sending the start notification. Read it before deleting the active-match record on finish. Send a fresh aggregated result photo per chat as a reply when the start message ID is available.
- On Telegram `sendPhoto` HTTP 403, clean up that chat's tracking data, subscription membership, active matches, and both image-cache prefixes. Skip the rest of that chat's notification work. Deduplication records expire through Firestore TTL. Propagate other send errors.
- Keep webhook error logs concise. Use the error message and Telegram response details when available. Raw Axios errors can contain large or circular request objects.
- Active-match discovery combines chat-local records with a six-hour cross-chat fallback from recent notification documents. The fallback depends on the stored `playerIds` array.

### Stats and Mini App

- Label calculated Rating values as estimates. Use `ratingEstimator.js` for command images, match results, and the Mini App API. Keep Rating grading consistent across `imageService.js` and `public/index.html`.
- Preserve `chatId` and optional `matchId` handling in the Mini App, including Telegram's `start_param` format. Preserve the separation between the active-match list and single-match details endpoints.

## Development and references

- Run `npm test` for the Jest suite. Unit tests live in `tests/unit/` and handler integration tests in `tests/integration/`. Mock external services for automated tests. Watch and coverage scripts are listed in the README.
- See [operations notes](docs/operations.md) for unofficial ELO endpoint diagnostics, Firestore TTL setup, and local Cloud Logging queries.
- The Telegram HTML widget migration starts with a planned `/stats` pilot in private chats. See the [rollout plan](docs/plans/html-bubbles-migration/html-bubbles-migration.md) and [migration tracker](docs/plans/html-bubbles-migration/migration-tracker.md).
- Project-specific agents are configured in `.codex/config.toml` and documented in `.codex/agents/`. Project skills live in `.agents/skills/`. Start a new Codex session after changing skills so the catalog can refresh.
