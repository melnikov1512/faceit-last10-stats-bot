---
applyTo: "src/services/imageService.js"
---

# Image Service — Conventions & Best Practices

`imageService.js` generates all FACEIT-styled PNGs (`@napi-rs/canvas`). Follow these rules when adding or modifying image-generation code.

## Design Tokens — Stay in Sync with `public/index.html`

The colour palette **must** match the web-app CSS variables exactly. Never hardcode a new colour without checking `public/index.html` first (a parallel task keeps `public/index.html`'s CSS variables aligned with this exact glassmorphism palette).

| Token | Value | Notes |
|---|---|---|
| `pageBg` | `#0A0A10` | Deepest backdrop tone, behind the colour mesh. |
| `bg` | `rgba(255,255,255,0.07)` | Glass panel fill (was solid `--card #1E1E1E`). |
| `headerBg` | `rgba(255,255,255,0.10)` | Slightly brighter glass fill for elevated sections. |
| `rowAlt` | `rgba(255,255,255,0.035)` | Subtle alternating row tint (was solid grey). |
| `accent` | `#FF7A33` | Brand orange, brightened for glass contrast. |
| `separator` | `rgba(255,255,255,0.18)` | Glass hairline border colour. |
| `positive` | `#6EE787` | Brighter green — must win contrast against the colour mesh. |
| `negative` | `#FF6B6B` | Brighter red — same reason. |
| `avatarBg` | `rgba(255,255,255,0.12)` | Avatar placeholder fill. |
| `trackedBg` | `rgba(255,122,51,0.14)` | Tracked-player row highlight. |
| `meshOrange` | `rgba(255,85,0,0.55)` | Mesh backdrop blob colour. |
| `meshTeal` | `rgba(0,194,204,0.42)` | Mesh backdrop blob colour. |
| `meshViolet` | `rgba(130,90,255,0.38)` | Mesh backdrop blob colour. |
| `positiveBorder` / `positiveTint` | `rgba(110,231,135,0.55)` / `rgba(110,231,135,0.14)` | Glass chip border/fill for positive signed values. |
| `negativeBorder` / `negativeTint` | `rgba(255,107,107,0.55)` / `rgba(255,107,107,0.14)` | Glass chip border/fill for negative signed values. |

Skill-badge colours (levels 1–10, `SKILL_COLOR`) are unchanged by the glassmorphism redesign and must still match the web-app skill-bar segments exactly (grey / green / gold / orange / brand-orange). If you change one side, update the other.

## Glassmorphism Panel Technique

- `GLASS_BLUR` (30px), `GLASS_RADIUS` (20px), and `CARD_MARGIN` (20px) are the core tuning constants for the frosted-glass look. `GLASS_BLUR` controls how soft the mesh looks through a panel; `GLASS_RADIUS` is the default outer card/section corner radius; `CARD_MARGIN` is the extra gutter added on every side by `renderAsGlassCard` so the sharp colour mesh is visible outside the card edges too.
- Every card shares one colourful "mesh" backdrop, drawn by `drawMesh` — three radial-gradient blobs (brand orange, teal, violet) over a near-black `pageBg` base.
- Canvas has no live `backdrop-filter` equivalent, so the frosted-panel effect is faked in `drawGlassPanel`: the mesh is redrawn at full canvas size, clipped to the panel's rounded-rect path, and blurred via `ctx.filter = 'blur(Npx)'` before a translucent tint is filled on top and a hairline `separator`-coloured border is stroked. This has been verified to render correctly in `@napi-rs/canvas`.
- Signed-value cells (Rating, K-D, ELO delta, Win%) no longer render as plain coloured text — they render as pill-shaped translucent "glass chips" via `drawGlassChip` (coloured border + coloured text over a light colour-matched tint fill).
- `renderAsGlassCard(width, contentHeight, draw)` is the shared entry point that wraps a card's `draw(ctx)` callback: it paints the sharp mesh across the full (margin-inclusive) canvas, then translates into the `CARD_MARGIN`-inset content area before invoking `draw`.

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

## FACEIT Reference Design — Post-Match Scoreboard (research notes, 2026-07-28)

Captured live via Playwright from `faceit.com/.../scoreboard` (computed styles, dark theme, "Итоги"/"Общее" tab) to guide any future work on `generateMatchResultImage` / `generateMatchResultsSummaryImage`. These are **reference values from FACEIT's own web app**, not necessarily our target — cross-check against the "Design Tokens" table above before changing our palette; treat conflicts as a deliberate product decision, not an auto-fix.

**Colour tokens observed:**

| Element | Colour | Notes |
|---|---|---|
| Page/table background | `rgb(18,18,18)` (`#121212`) | Matches our `pageBg` exactly. |
| Table header background (normal) | `rgb(29,29,29)` (`#1D1D1D`) | Slightly darker than our `headerBg #2A2A2A`. |
| Table header / column background (active/sorted column, e.g. "Рейтинг") | `rgb(36,36,36)` (`#242424`) | Sorted/highlighted column gets a lighter solid background per-cell (looks "pinned"). Also used as the avatar-ring border colour. |
| Primary text (stat values, names) | `rgb(241,241,241)` (`#F1F1F1`) | |
| Secondary/muted text (header labels, losing score) | `rgb(167,167,167)` (`#A7A7A7`) | |
| Tertiary caption text (MVP label, stat captions like "Swing"/"K/D/A") | `rgb(204,204,204)` (`#CCCCCC`) | |
| Rating positive (badge text + `rgba(...,0.16)` tint background, `border-radius:4px` pill) | `rgb(106,222,67)` (`#6ADE43`) | Brighter/more saturated than our `positive #52BC6A`. |
| Rating negative (same pill pattern) | `rgb(255,39,39)` (`#FF2727`) | More saturated than our `negative #FF5757`. |
| Winner round score | `rgb(50,211,90)` (`#32D35A`) | **Different green** from the Rating-positive green above — FACEIT uses two distinct greens for two different meanings (final score vs. per-stat rating). |
| MVP star icon | `rgb(255,172,0)` (`#FFAC00`) | Gold/amber, not yellow. |
| Brand accent bar (decorative highlight strip) | `rgb(255,85,0)` (`#FF5500`) | |
| Avatar ring border | `1px solid #242424`, `border-radius: 99999px` (full pill) | Hero/MVP avatar rendered at 118px inside a 120px holder. |

**Asymmetric "Swing" (ELO/rating delta) colouring — notable pattern:** positive Swing is rendered in **plain primary text colour** (`#F1F1F1`/white, not green), while negative Swing is rendered in **red** (`#FF2727`). FACEIT does not use green for positive deltas in this widget — only red signals "bad". This differs from our current convention (`positive`/`negative` both colour-coded in `generateMatchResultImage`'s ELO delta). Keep our symmetric green/red convention unless a future task explicitly asks to match FACEIT's asymmetric style.

**Layout patterns worth referencing:**

- **Hero/MVP card** (top of "Итоги" tab): circular avatar (118px) + nickname + skill badge, gold star + "MVP" caption top-right, followed by a stat block: big Rating value (22px/700) with its Swing % beside/below it, then K/D/A (as a single `29/17/7` string), ADR (labelled "СУ/Р"), and HS% (labelled "Убийств в голову, %") — each stat is a `{value: 22px/700 primary} / {caption: 14–16px/400, #CCCCCC}` pair.
- **Per-team table**: one table per team, header row = team name (28px/700) + round score (38px/700; winner in `#32D35A`, loser in `#A7A7A7`) + team avg skill badge/ELO + half-time score labels ("First half N", "Вторая половина N"). Columns: Player (avatar + nickname + small coloured diamond/triangle marker = team identity, not side) → Rank (skill badge + ELO) → Rating (colour pill, sortable/highlighted column) → Swing % → K, D, A → ADR ("СУ/Р") → K/Round, D/Round ("У/С", "У/Р") → HS, HS% → multi-kill counts (5K/4K/3K/2K) → MVP count.
- **Rating cell** is always rendered as a rounded pill (`border-radius:4px`) with a light tint background matching the value's colour (green/red at `0.16` alpha) — this pill pattern (colour-matched tint background behind a bold coloured number) is a reusable idea for any future "rating-like" stat cell in our cards (e.g. K/D ratio, ADR tier).
