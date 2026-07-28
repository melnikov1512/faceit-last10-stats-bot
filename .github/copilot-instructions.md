# Faceit Last 10 Stats Bot — Copilot Instructions

> **Documentation is organized using GitHub Copilot's instruction files.**
> **Each `.instructions.md` file automatically applies to specific file patterns.**

---

## Instruction Files

> Instruction files in `.github/instructions/` are auto-applied by Copilot based on `applyTo` glob patterns in each file's frontmatter. No manual switching needed.

---

## Essential Quick Rules

### Response Style

- Keep responses short and direct
- List affected files after completion
- **Never commit or push changes unless explicitly asked to commit/push**
- **If the message contains a question — answer it, do not jump to implementation.**
  Questions are identified by: question marks, words like "how", "why", "what", "should I", "can I", or any phrasing that seeks information rather than action. Answering a question is not permission to implement anything.

### Planning (CRITICAL)

**When to create a plan:**
If the user's message contains an explicit planning request — create a plan file immediately.
Trigger phrases (and synonyms): "plan this", "prepare a plan", "outline", "create a plan", "let's plan".

- Create the plan file at the correct path right away — do not present the plan inline in chat
- After creating, briefly report the file path and key points

**Save all plans to:**

```
docs/plans/<plan-name>/<plan-name>.md
```

Folder and file name must be kebab-case describing the task.

All supporting files (research, temp scripts, drafts, diagrams) go in the **same plan folder**:

```
docs/plans/<plan-name>/
├── <plan-name>.md
├── research.md
└── any-other-supporting-file
```

Never create supporting files in the root `docs/` or in arbitrary locations.

**Never implement a plan automatically.** After creating a plan, always ask:

> "Ready to implement. Shall I proceed?"

Only begin implementation when the user explicitly confirms (e.g., "yes", "go ahead", "proceed", "implement it").
Approving or commenting on a plan is **not** permission to implement it.

### Link Verification (CRITICAL)

- Never state or output a URL (chat, code comments, commit/PR text, generated docs) unless it was just confirmed as live: either returned directly by a tool call in the current turn (search results, `get_file_contents`, API responses), or actually fetched (`web_fetch`, browser tools) and shown to return a successful response with real, on-topic content.
- Never invent or reconstruct a URL from memory/training data (e.g., guessing a docs path pattern) and present it as fact.
- If a link cannot be verified, say so explicitly (e.g., "I could not verify this link is live") instead of presenting a possibly-broken link as fact; prefer citing the resource name/search query over a guessed URL.
- If the primary fetch tools fail to verify a link (blocked, JS-rendered, CAPTCHA, timeout, non-200), retry verification using a browser automation tool (e.g., Playwright: `browser_navigate` + `browser_snapshot`) before concluding the link is dead or unreachable.

### Language (CRITICAL)

- **All code comments must be written in English only** — regardless of the language used in chat.
- **All documentation** (README, AGENTS.md, `docs/**`, plan files, inline JSDoc) **must be written in English only**.
- This rule is not automatically inherited by sub-agents when delegating tasks — it is duplicated directly inside the `.agent.md` files of agents that write code or docs (`gem-implementer`, `gem-code-simplifier`, `gem-documentation-writer`). See individual agent files for details.

---

## How Instructions Work

Copilot automatically loads the relevant `.github/instructions/*.instructions.md` file based on the file you're editing. When you work on:

- **A `scripts/*.js` file or a config file** → `node-scripts.instructions.md` applies
- **CI/CD, `package.json`, or run-time config** → `agents-maintenance.instructions.md` applies (keep `AGENTS.md` in sync)
- **Anything touched under `.github/**` or docs** → `readme-maintenance.instructions.md` applies (keep `README.md` in sync)
