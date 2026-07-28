---
applyTo:
    - "scripts/**/*.js"
    - "*.config.js"
---

# Node.js Scripts — Conventions & Best Practices

## File Structure

Every script in `scripts/` must follow this section order:

```
// scripts/<name>.js — one-line description
//
// Usage:
//   node scripts/<name>.js --flag value
//
// Options:
//   --flag, -f   Description (default: value)

'use strict';

const { parseArgs } = require('node:util');
// ... other requires

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

function fatal(msg) {
    console.error(`Error: ${msg}`);
    process.exit(1);
}
```

---

## `node:` Protocol Prefix

**CRITICAL**: Always use the `node:` prefix for all built-in module imports.

**✅ CORRECT**
```js
const { spawnSync }         = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path                  = require('node:path');
const { parseArgs }         = require('node:util');
```

**❌ INCORRECT**
```js
const { spawnSync } = require('child_process');
const fs = require('fs');
```

Why: prevents shadowing by npm packages, unambiguous resolution, required by modern ESLint rules.

---

## `'use strict'`

**CRITICAL**: Declare `'use strict'` at the top of every `scripts/*.js` file.

Node.js CommonJS modules are **not** strict by default in any version, including Node 22.
ES modules (`.mjs`) are always strict — the directive is redundant there.
This project has no `"type":"module"` in `package.json` → all `.js` files are CJS → strict mode must be explicit.

**✅ CORRECT**
```js
// scripts/my-script.js — description

'use strict';

const { parseArgs } = require('node:util');
```

---

## CLI Argument Parsing — `parseArgs`

**Use `parseArgs` from `node:util` for all new scripts.** Requires Node 18.11.0+
(covered by the project `engines` field).

**✅ CORRECT — `parseArgs` pattern**
```js
const { parseArgs } = require('node:util');

const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        'target-org':    { type: 'string',  short: 'o' },
        'validate-only': { type: 'boolean', short: 'v', default: false },
        'source-dir':    { type: 'string',  short: 's', default: 'force-app' },
        'wait':          { type: 'string',  short: 'w', default: '30' },
    },
    strict: true,       // throws on unknown flags — good for early error detection
    allowPositionals: false,
});

if (!values['target-org']) fatal('--target-org is required');
```

**Short option rules:**
- Single character only (`-o`, `-t`), not multi-char (`--src` as alias is not supported by `parseArgs`)
- `default` values are set in the options definition, not separately

**When to use manual `switch` instead:**
- Multi-char aliases are required (e.g., `--src` as alias for `--source-dir`)
- Complex per-flag validation with custom error messages per flag
- Porting an existing script where `parseArgs` would not reduce complexity

---

## Subprocess Execution

### `spawnSync` — for CLI wrapper scripts (pass-through)

Use `spawnSync` when the script wraps another CLI command and needs to stream
terminal I/O in real time (e.g., `sf`, `git`, `npm`).

**✅ CORRECT**
```js
const { spawnSync } = require('node:child_process');

const result = spawnSync('sf', ['project', 'deploy', 'start', '--target-org', targetOrg], {
    stdio: 'inherit',   // connects child stdin/stdout/stderr directly to the terminal
    shell: false,       // NEVER use shell:true with user-provided input (injection risk)
});

if (result.error) fatal(`failed to run sf: ${result.error.message}`);

process.exit(result.status ?? 1);
```

Key properties:
- `stdio: 'inherit'` — streams child I/O directly to the parent terminal (required for interactive/long-running commands)
- `shell: false` — args are passed as an array, not a shell string; prevents injection

### `execSync` — for capturing output

Use `execSync` only when you need the command's stdout as a string, and the command
contains **no user-supplied input**.

**✅ CORRECT**
```js
const { execSync } = require('node:child_process');

const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
console.log(`Current branch: ${branch}`);
```

**❌ INCORRECT — user input in execSync**
```js
// DANGEROUS — shell injection if targetOrg contains special chars
const out = execSync(`sf org display --target-org ${targetOrg}`);
```

---

## Error Handling

### `fatal()` helper

Define a `fatal()` function at the **bottom** of every script for user-facing errors.
No stack trace — just a clear message and exit code 1.

**✅ CORRECT**
```js
if (!existsSync(sourceDir)) fatal(`source directory '${sourceDir}' not found`);

// At the bottom of the file:
function fatal(msg) {
    console.error(`Error: ${msg}`);
    process.exit(1);
}
```

### Uncaught exception handler (for production scripts)

Add a global handler to prevent raw stack traces from leaking to end users:

```js
process.on('uncaughtException', (err) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
});
```

---

## Exit Codes

| Pattern | When to use |
|---|---|
| `process.exit(result.status ?? 1)` | Subprocess passthrough — propagate the child exit code |
| `process.exit(1)` | Fatal validation/runtime error inside the script itself |
| `process.exitCode = 1` | Async scripts — set code before event loop drains (no explicit exit needed) |

**✅ CORRECT — subprocess passthrough**
```js
const result = spawnSync('sf', sfArgs, { stdio: 'inherit', shell: false });
if (result.error) fatal(`failed to run sf: ${result.error.message}`);
process.exit(result.status ?? 1);
```

---

## Module Format — Stay CJS

**CRITICAL**: All scripts must remain CommonJS (CJS). Do **not** add `"type":"module"` to
`package.json` — this would break all tooling config files.

CJS advantages for scripts:
- `__dirname` and `__filename` available directly (no `import.meta.url` workaround)
- Synchronous `require()` — simpler for scripts without top-level `await`
- Compatible with all devDependencies (eslint, jest, prettier, husky)

If a future script needs `async/await`, wrap in an async IIFE:

**✅ CORRECT — async in CJS**
```js
'use strict';

(async () => {
    const data = await fetchSomething();
    console.log(data);
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
```

---

## Artifact Directories

Create output directories with `mkdirSync` using `{ recursive: true }`:

```js
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const artifactsDir = '.artifacts/my-script';
mkdirSync(path.join(artifactsDir, 'results'), { recursive: true });
```

---


## npm Script Integration

Every script in `scripts/` should have a corresponding entry in `package.json` `scripts`:

```json
{
    "scripts": {
        "set-webhook": "node scripts/set-webhook.js",
        "test-notify": "node scripts/test-notify.js"
    }
}
```

Usage: `npm run test-notify -- --nickname s1mple --chatId 123456`
The `--` separates npm arguments from the script's own flags.

---

## Complete Example

```js
// scripts/example.js — example script showing all patterns
//
// Usage:
//   node scripts/example.js --chat-id <id> [--dry-run]
//
// Options:
//   --chat-id, -c   (required) Telegram chat id
//   --dry-run, -d   Print the request without sending it

'use strict';

const https          = require('node:https');
const { parseArgs }  = require('node:util');

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        'chat-id': { type: 'string',  short: 'c' },
        'dry-run': { type: 'boolean', short: 'd', default: false },
    },
    strict: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

if (!values['chat-id']) fatal('--chat-id is required');

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

console.log(`▶ Sending test message to chat ${values['chat-id']}`);

if (values['dry-run']) {
    console.log('Dry run — exiting.');
    process.exit(0);
}

// ... perform the actual request here

// ─────────────────────────────────────────────────────────────────────────────

function fatal(msg) {
    console.error(`Error: ${msg}`);
    process.exit(1);
}
```
