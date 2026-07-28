---
applyTo: "src/services/imageService.js"
---

# Image Service — Conventions & Best Practices

`imageService.js` generates all FACEIT-styled PNGs (`@napi-rs/canvas`). Follow these rules when adding or modifying image-generation code.

## Design Tokens — Stay in Sync with `public/index.html`

The colour palette **must** match the web-app CSS variables exactly. Never hardcode a new colour without checking `public/index.html` first.

| Token | Value | CSS variable |
|---|---|---|
| `pageBg` | `#121212` | — |
| `bg` | `#1E1E1E` | `--card` |
| `headerBg` | `#2A2A2A` | `--card2` |
| `separator` | `rgba(255,255,255,0.07)` | `--divider` |
| `positive` | `#52BC6A` | `--green` |
| `negative` | `#FF5757` | `--red` |

Skill-badge colours (levels 1–10) must match the web-app skill-bar segments exactly (grey / green / gold / orange / brand-orange). If you change one side, update the other.

## Fonts

- Use the bundled Inter WOFF2 fonts in `src/assets/fonts/`, registered via `GlobalFonts`. **Never** rely on system fonts — rendering must be pixel-identical on macOS (dev) and Linux (Cloud Functions).
- The bundled font is **Latin-only**. Any new label/text must use Latin characters or abbreviations (see `generateActivityImage`'s `"NhMmin"` format as the pattern to follow for non-Latin-friendly labels).

## Canvas Drawing Performance

- When generating **multiple cards in one image** (e.g. `generateMatchResultsSummaryImage`), draw all cards directly onto **one shared canvas context** — never render N separate canvases and stitch/encode them. Only call `toBuffer()` once per exported function.
- Load all remote assets (avatars) **in parallel** with `Promise.all` before starting any drawing — never `await` an avatar fetch per-card inside a sequential loop.
- Extract shared per-card drawing logic into a private `_draw*Card(ctx, data, offsetY, ...)` helper so single-card and multi-card exporters share one code path (see `_drawMatchResultCard`).

## Avatar Loading

- Always load avatars through a private `_loadAvatar(url)`-style helper that **catches all errors and returns `null`** on failure. A missing/broken avatar must never throw or break card generation — fall back to a placeholder (e.g. initial letter).

## FACEIT Unofficial Endpoints (Cloudflare-Protected)

- Endpoints under `api.faceit.com` and `www.faceit.com/api/...` (ELO timeline, match-rounds, scoreboard-summary) are **not** part of the official Data API v4 and are Cloudflare-protected.
- Fetch the ELO timeline endpoint with Node's native `fetch`, **not axios** — axios triggers Cloudflare blocking on this endpoint.
- **Never call these unofficial endpoints concurrently from the same process/IP** — batch/sequence them (see `getLeaderboardStats`'s two-step sequential-then-parallel pattern) to avoid HTTP 403s.
- These endpoints are known to be blocked entirely from some sandbox/CI and even some production egress IP ranges (Cloudflare IP-reputation block, not a rate limit). Always keep a **graceful fallback** (e.g. `avg_faceit_rating = null` → pure-ADR sort) — never let a 403 from an unofficial endpoint crash a request path that has official-API data available.
- Prefer the official `open.faceit.com` Data API v4 (Bearer token) wherever the data is available there instead of an unofficial endpoint.

## Batching & Rate Limits

- Process player lookups in chunks (10 at a time is the existing convention) to respect FACEIT API rate limits.
- Reuse the single module-level axios client (`getApiClient`) for all official API calls — do not create a new axios instance per call.

## Output Contracts

- Every `generate*Image` export must return `Promise<Buffer>` (a PNG buffer) — never a canvas object or a data URL.
- Keep new card widths consistent with existing conventions (720px for leaderboard-style tables, 540–580px for single-entity cards) unless there's a strong layout reason to diverge — document any deviation.
