---
applyTo: ".github/workflows/**,package.json,config.json,src/config.js,jest.config.js,index.js"
---

After modifying this file, check whether `AGENTS.md` and `README.md` need updating.

Update `AGENTS.md` if the change affects any of the following:
- Available `npm` scripts or their behaviour
- CI/CD workflows (new workflow, renamed job, changed triggers or secrets)
- Repository secrets or environment variables used by the bot (`FACEIT_API_KEY`, `TELEGRAM_BOT_TOKEN`, `FACEIT_WEBHOOK_SECRET`, `GCLOUD_PROJECT`, `WEBAPP_URL`, `BOT_USERNAME`, etc.)
- Tool conventions (linter config, formatter settings, test runner)
- Integration boundaries or authentication patterns (FACEIT API, Telegram Bot API, Firestore)

Skip if the change is cosmetic, a bug fix with no behavioural impact, or already accurately reflected in `AGENTS.md`.
