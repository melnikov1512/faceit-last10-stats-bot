---
goal: Remove the permanently-broken real FACEIT Rating fetch logic and replace it with a locally estimated HLTV Rating 2.0 approximation in /stats, /mystats and the web-app match view
version: 1.1
date_created: 2026-07-28
last_updated: 2026-07-28
owner: faceit-last10-stats-bot maintainers
status: 'Completed'
tags: [feature, refactor, faceit, rating, image, api]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

The real FACEIT Rating is only available through the unofficial `www.faceit.com/api/statistics/v1/cs2/...` endpoints (`getPlayerMatchRoundRatings` for `/stats`/`/mystats`, and `getMatchScoreboardRatings` for the web-app's `GET /api/match`). Both are confirmed **HTTP 403 for every request from Cloud Run** (Cloudflare IP-reputation block on datacenter egress) and are unlikely to ever become available again from this hosting environment. Keeping this dead fetch logic in the codebase has no benefit and adds maintenance burden.

This plan has two parts:
1. **Remove** the obsolete real-Rating fetch logic end-to-end (service functions, wiring, API field, web-app rendering branch, and related tests/docs).
2. **Replace** it with a locally computed **estimated Rating** — the publicly published HLTV Rating 2.0 regression approximation (from the MIT-licensed `pnxenopoulos/awpy` project) — calculated entirely from fields already returned by the official FACEIT Data API v4 (Kills, Deaths, Assists, ADR, Rounds). This restores a Rating-like signal in `/stats` and `/mystats` at zero additional cost and zero new network calls, clearly labelled as an estimate (`~` prefix) so it is never confused with FACEIT's own proprietary number.

The web-app's `/api/match` per-match Rating field is removed as dead weight in part 1; re-adding an estimate there is explicitly out of scope for this plan (see Alternatives).

## 1. Requirements & Constraints

- **REQ-001**: All real-Rating fetch logic tied to the confirmed-broken unofficial endpoints must be fully removed — no dead/unreachable code paths, mocks, or fixtures left behind — before the estimated rating is implemented.
- **REQ-002**: Compute the estimated rating using only fields available from the official FACEIT Data API v4 per-match stats (`Kills`, `Deaths`, `Assists`, `ADR`, `Rounds`) — no calls to unofficial/Cloudflare-protected endpoints.
- **REQ-003**: Use the published awpy HLTV Rating 2.0 regression formula (`pnxenopoulos/awpy`, MIT licensed, fetched and verified during prior research) as the calculation basis.
- **REQ-004**: Substitute a fixed KAST constant (`73.0`, community average) since KAST is not exposed by the official API and cannot be derived from it.
- **REQ-005**: The estimated rating must be visually distinguished (`~` prefix) from a plain stat, so users understand it is an approximation of FACEIT's real (now unreachable) Rating, not an exact figure.
- **REQ-006**: Must work for both `/stats` (multi-player) and `/mystats` (single untracked player), since both commands share `getLeaderboardStats()` + `generateStatsImage()`.
- **REQ-007**: The web-app's `GET /api/match` response must no longer expose a `faceitRating` field once the fetch logic is removed (part 1) — this plan does not re-add an estimate there (see ALT-004).
- **SEC-001**: No new external network calls, no new third-party services, no secrets.
- **CON-001**: `imageService.js`'s bundled Inter font is Latin-only — any new label text (estimate marker, footer note) must use ASCII/Latin characters only.
- **CON-002**: Design tokens (colours) in `imageService.js` must reuse the existing palette (`COLOR.subtext`, `COLOR.positive`, `COLOR.negative`, `COLOR.text`) — no new hardcoded colours, per `.github/instructions/image-service.instructions.md`.
- **GUD-001**: Keep the estimation formula pure (no I/O) and unit-testable in isolation, in its own service module, matching the project's one-concern-per-file convention.
- **GUD-002**: Follow existing code style — JSDoc on exported functions, English-only comments.
- **PAT-001**: Compute the estimate per match, then average across the analysed matches — the same aggregation shape the removed real-rating code used, applied to the new formula.

## 2. Implementation Steps

### Implementation Phase 1 — Remove obsolete real-Rating fetch logic

- GOAL-001: Delete every code path, field, test, and doc reference tied to the two confirmed-broken unofficial Rating endpoints, so the codebase has no dead weight before the estimate is built.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `src/services/faceitService.js`, remove `getPlayerMatchRoundRatings()` (~L232-308), its `MATCH_ROUNDS_BASE_URL` constant (~L9), and `fetchWithRetry()` (~L17-40) — the latter has no other caller once `getPlayerMatchRoundRatings` is gone. | | |
| TASK-002 | In `src/services/faceitService.js`, remove `getMatchScoreboardRatings()` (~L172-230) and its `SCOREBOARD_BASE_URL` constant (~L6-7); remove its entry from `module.exports` (~L738). | | |
| TASK-003 | Simplify `getPlayerStats()` (~L342-416): drop the `preloadedRatings` parameter, the match-rounds lookup block (~L381-401), and the `avg_faceit_rating` / `faceit_rating_matches` output fields. Leave ELO/avatar/stats aggregation logic unchanged. Update the function's JSDoc to remove the `preloadedRatings` param description. | | |
| TASK-004 | Simplify `getLeaderboardStats()` (~L419-464): remove Step 1's sequential match-rounds pre-fetch loop (~L433-440) entirely, and its explanatory comment about Cloudflare sequential-only calls. Replace the `withRating`/`withoutRating` split with a single ADR-DESC sort as a temporary state (Implementation Phase 3 replaces this with the estimated-rating sort). | | |
| TASK-005 | In `src/handlers/apiHandler.js`, remove the `getMatchScoreboardRatings` import (~L2) and the "Enrich with FACEIT Rating" block (~L222-232) inside `getMatch()`. The `matchStats.players[].faceitRating` field is dropped from the `/api/match` response entirely (REQ-007). | | |
| TASK-006 | In `public/index.html`, remove the now-permanently-dead `hasFaceitRating` branch (~L920-958) in the match-stats table renderer (`ratingCell`, `ratingHeader`, rating-based sort) — render the stats table using only its non-rating columns/sort, since `faceitRating` will never be present again. | | |
| TASK-007 | Delete `tests/unit/getMatchScoreboardRatings.test.js` (the function no longer exists). | | |
| TASK-008 | Update `tests/unit/getLeaderboardStats.test.js`: remove `matchRounds` fixtures and the `fetch`/match-rounds mock plumbing; adjust assertions to match the temporary single ADR-sort behaviour introduced in TASK-004 (further revised in Implementation Phase 3's TASK-013). | | |
| TASK-009 | Update `tests/integration/apiHandler.test.js`: remove the `getMatchScoreboardRatings` mock (~L45) and the two `faceitRating`-specific test cases (~L185-215, ~L216-246); add/adjust an assertion that `matchStats.players[].faceitRating` is `undefined` (field absent) in the response. | | |
| TASK-010 | Update `AGENTS.md`: remove all references to `getPlayerMatchRoundRatings`, `getMatchScoreboardRatings`, `MATCH_ROUNDS_BASE_URL`/`SCOREBOARD_BASE_URL`, the "KNOWN BROKEN IN PRODUCTION" note, and the web-app's `hasFaceitRating` description. Leave a short historical note that real-Rating fetching was removed as permanently broken, superseded by the local estimate documented in Implementation Phase 4's doc task. | | |

### Implementation Phase 2 — Build the rating estimator module

- GOAL-002: Implement and unit-test the pure HLTV Rating 2.0 approximation formula in isolation, after confirming the exact official-API field names it depends on.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Fetch one live sample via `GET /players/{id}/games/cs2/stats?limit=1` (official API, existing `FACEIT_API_KEY`) for a real tracked player and confirm the exact key names for total rounds played and assists in `item.stats` (expected `Rounds`, `Assists` per community convention — `ai-files/faceit-open-api.json` stats maps are untyped `additionalProperties: {}`, so this must be confirmed against a live response, not the spec). Record the confirmed key names as a code comment in `ratingEstimator.js`. | | |
| TASK-012 | Create `src/services/ratingEstimator.js` exporting `estimateMatchRating({ kills, deaths, assists, rounds, adr, kast })` implementing the awpy Rating 2.0 regression formula (`impact = 2.13*(kills/rounds) + 0.42*(assists/rounds) - 0.41`; `rating = 0.0073*kast + 0.3591*(kills/rounds) - 0.5329*(deaths/rounds) + 0.2372*impact + 0.0032*adr + 0.1587`), plus `DEFAULT_KAST_ESTIMATE = 73.0`. Return `null` when `rounds <= 0`. All numeric params default to `0`; `kast` defaults to `DEFAULT_KAST_ESTIMATE`. | | |
| TASK-013 | Add `tests/unit/ratingEstimator.test.js` covering: `rounds = 0` → `null`; a typical match's inputs produce a value in the plausible `0.5–2.0` range; increasing kills/ADR increases the result (monotonicity); a custom `kast` override changes the result; a fixed-input regression case asserting the output matches a hand-computed expected value to 3 decimal places. | | |

### Implementation Phase 3 — Wire the estimate into faceitService.js as the sole Rating source

- GOAL-003: Compute a per-player estimated rating (averaged across the analysed matches) and make it the sole basis for the Rating column and leaderboard sort, now that the real-rating path no longer exists.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | In `src/services/faceitService.js`, `require('./ratingEstimator')` and add a private helper `estimateAverageRating(statsArray)` that maps each match's `Kills`/`Deaths`/`Assists`/`ADR`/confirmed-rounds-key (via `estimateMatchRating`) and averages the non-null results. | | |
| TASK-015 | In `getPlayerStats`, call `estimateAverageRating(allStats)` and attach the result to `stats.estimated_rating` (`number\|null`). | | |
| TASK-016 | In `getLeaderboardStats`, replace the temporary ADR-only sort from Phase 1 TASK-004 with: sort DESC by `estimated_rating`, falling back to ADR DESC when `estimated_rating` is `null` for both compared players (e.g. missing rounds field) — a single sorted list, no more two-group split. | | |
| TASK-017 | Update `tests/unit/getLeaderboardStats.test.js` (started in TASK-008): add fixtures with the confirmed rounds/assists keys and assert the final sort order is driven by `estimated_rating` DESC, with ADR DESC as the tiebreak/fallback. | | |

### Implementation Phase 4 — Display the estimate in the stats image

- GOAL-004: Render the estimated rating in the existing Rating column, marked as an estimate, without introducing new colours or fonts.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | In `src/services/imageService.js`, update `generateStatsImage`'s `showRating` check (~L289) to `leaderboard.some(p => p.estimated_rating != null)`. | | |
| TASK-019 | In `drawRow`'s `hasRatingCol` branch (~L226-232), read `player.estimated_rating` directly (the `avg_faceit_rating`/`rCount` real-rating variables no longer exist after Phase 1) and format the cell as `` `~${estimated_rating.toFixed(2)}` `` (or `'—'` when `null`). Reuse `getRatingColor(estimated_rating)` unchanged — no new colours. | | |
| TASK-020 | In `drawFooter` (~L260-268), add a `hasEstimatedRating` boolean param; when `true` (i.e. the Rating column is shown), render an additional left-aligned ASCII line `"~ = estimated Rating"` using `COLOR.subtext` / `FONT.footer`. Update the call site in `generateStatsImage` to pass `showRating`. | | |
| TASK-021 | Manually verify rendering (see TEST-004) since Canvas output is intentionally not unit-tested in this repo (per `AGENTS.md`) — no automated visual test to add. | | |

### Implementation Phase 5 — Documentation

- GOAL-005: Keep project documentation in sync per repo conventions, describing the new estimate feature (the removal itself was already documented in Phase 1 TASK-010).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-022 | Update `AGENTS.md` Image/Stats Module sections: document `estimated_rating`, the new `ratingEstimator.js` module, and the updated single-sort/display behaviour. | | |
| TASK-023 | Set this plan's front-matter `status` to `Completed` once the implementation is merged. | | |

## 3. Alternatives

- **ALT-001**: Demo-file parsing for an exact HLTV-formula rating with real KAST (research recommendation #2) — deferred; higher effort (2–4 days), requires a new async pipeline via the FACEIT webhook (`demo_url` field) + Firestore cache. Would need its own fetch/parse code built from scratch (this plan intentionally removes the old broken fetch, not a future clean implementation).
- **ALT-002**: Residential proxy / relay VM to unblock the existing unofficial endpoints instead of removing them — rejected due to FACEIT ToS risk and ongoing hosting cost (see prior research, Option 4).
- **ALT-003**: Drop the Rating column entirely and keep pure-ADR sorting, without building an estimate — rejected because it discards a useful, cheap-to-compute signal, and the column layout/colour-coding already exist in the codebase.
- **ALT-004**: Also add an estimated rating to the web-app's `GET /api/match` per-match view (in place of the removed `faceitRating`) — explicitly out of scope for this plan (REQ-007); the web app already degrades gracefully by hiding the Rating column/header when the field is absent (`hasFaceitRating` check, removed in Phase 1 as it becomes permanently `false`). Can be proposed as a separate follow-up plan.

## 4. Dependencies

- **DEP-001**: None — the formula is vanilla JS arithmetic on data already fetched via the existing `getPlayerGameStats` call (official API). No new npm package required.
- **DEP-002**: Existing `@napi-rs/canvas` (already installed) for image rendering — no version change needed.

## 5. Files

- **FILE-001**: `src/services/faceitService.js` — remove `getPlayerMatchRoundRatings`, `getMatchScoreboardRatings`, `fetchWithRetry`, `MATCH_ROUNDS_BASE_URL`, `SCOREBOARD_BASE_URL`; simplify `getPlayerStats()` and `getLeaderboardStats()`; later add `estimateAverageRating()` and wire `estimated_rating`.
- **FILE-002**: `src/handlers/apiHandler.js` — remove the scoreboard-rating enrichment block and its import in `getMatch()`.
- **FILE-003**: `public/index.html` — remove the dead `hasFaceitRating` rendering branch in the match-stats table.
- **FILE-004**: `src/services/ratingEstimator.js` (new) — pure `estimateMatchRating()` formula + `DEFAULT_KAST_ESTIMATE` constant.
- **FILE-005**: `src/services/imageService.js` — update `generateStatsImage()`, `drawRow()`, `drawFooter()`.
- **FILE-006**: `tests/unit/getMatchScoreboardRatings.test.js` — deleted.
- **FILE-007**: `tests/unit/getLeaderboardStats.test.js` — fixtures/assertions rewritten for the removal, then for the new estimated-rating sort.
- **FILE-008**: `tests/integration/apiHandler.test.js` — remove `faceitRating`-specific mocks/assertions.
- **FILE-009**: `tests/unit/ratingEstimator.test.js` (new).
- **FILE-010**: `AGENTS.md` — remove obsolete architecture notes (Phase 1), add new estimate documentation (Phase 5).

## 6. Testing

- **TEST-001**: `npm test` after Phase 1 — full suite passes with no references to the removed functions/fields (confirms clean removal before new code is added).
- **TEST-002**: `tests/integration/apiHandler.test.js` — `GET /api/match` response's `matchStats.players[].faceitRating` is `undefined` (field no longer present).
- **TEST-003**: `ratingEstimator.test.js` — pure formula unit tests (zero-rounds guard, monotonicity, custom KAST, fixed-input regression value).
- **TEST-004**: `getLeaderboardStats.test.js` — final sort order driven by `estimated_rating` DESC with ADR DESC fallback.
- **TEST-005**: Manual verification — generate a stats image locally with a mixed fixture (one player with `estimated_rating`, one with `null`), save the PNG, and visually confirm the `~` marker, footer note, and colour coding render correctly (no automated Canvas snapshot testing exists in this repo).
- **TEST-006**: Run the full suite (`npm test`) after Phase 4 to confirm no regression in `tests/integration/commandHandler.test.js`, which also consumes `getLeaderboardStats()`'s output shape.

## 7. Risks & Assumptions

- **RISK-001**: The exact field name for total rounds played in `item.stats` is unverified against a live API response (community convention assumes `Rounds`). If absent or differently named, `estimated_rating` stays `null` for everyone and the feature silently degrades to a pure-ADR sort (safe, but defeats the purpose). Mitigated by TASK-011 before building on top of it.
- **RISK-002**: The awpy regression approximation is fitted to HLTV Rating 2.0, not FACEIT's own proprietary algorithm — values will visibly diverge from what a player sees on faceit.com for the same match. Mitigated by the mandatory `~` labelling (REQ-005).
- **RISK-003**: Substituting a fixed `KAST = 73` constant systematically over/under-rates outlier playstyles (aggressive entry fraggers, passive lurkers). Acceptable per prior research findings (~±0.15 average error) but must be documented as a known limitation in `AGENTS.md` (TASK-022).
- **RISK-004**: Removing the `faceitRating` field from `GET /api/match` is a response-shape change. Mitigated: the field has been `null` in production for every request since the endpoint went dark (per `AGENTS.md`'s existing "KNOWN BROKEN" note), and `public/index.html` already treats its absence gracefully (`hasFaceitRating` check) — no observable regression for end users.
- **ASSUMPTION-001**: `getPlayerGameStats`'s per-match `stats` map already reliably contains `Kills`, `Deaths`, `Assists`, `ADR` (proven by existing `calculateAverageStats`/`extractPlayerMatchStats` code); it is assumed, pending TASK-011, that a rounds-played field is also present in that same map.
- **ASSUMPTION-002**: The existing Rating column (`COLUMNS_WITH_RATING`, 88px width, `FONT.statCell` 22px Inter) has enough room for a string like `~1.24` without layout changes — to be visually confirmed in TEST-005.
- **ASSUMPTION-003**: No consumer outside this repository depends on the `/api/match` `faceitRating` field (it is an internal API used only by this bot's own `public/index.html` web app), so removing it (TASK-005/TASK-009) carries no external breaking-change risk.

## 8. Related Specifications / Further Reading

- Prior research conducted in this session ("Итоги ресерча: варианты показа FACEIT Rating") — ranked recommendation #1 is the basis of Implementation Phases 2–4; formula verified against `pnxenopoulos/awpy:awpy/stats/rating.py` (MIT licensed) fetched during that research.
- `AGENTS.md` — Image Module section (existing FACEIT Rating architecture and the "KNOWN BROKEN IN PRODUCTION" note this plan removes and supersedes).
- `.github/instructions/image-service.instructions.md` — canvas/font/design-token conventions this plan must follow.
