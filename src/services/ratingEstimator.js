'use strict';

// Verified live on 2026-07-28 via the official FACEIT v4 player-stats endpoint: per-match item.stats uses "Rounds" and "Assists" keys.
// Verified live on 2026-07-29 via /players/{id}/games/cs2/stats: per-match item.stats also exposes
// "Double Kills", "Triple Kills", "Quadro Kills", "Penta Kills" and "MVPs".
// Verified live on 2026-07-29 via /matches/{id}/stats: player_stats additionally exposes
// "Entry Wins", "1v1Wins" and "1v2Wins" (only on the single-match endpoint, not the player-stats one).

/**
 * Community-average KAST substitute because the official FACEIT Data API v4 does not expose real per-match KAST.
 *
 * @type {number}
 */
const DEFAULT_KAST_ESTIMATE = 73.0;

/**
 * FACEIT's own Rating (Season 8, win-probability-added model) publishes an average baseline
 * of ~1.1, while the public HLTV Rating 2.0 regression this estimator is based on centers on
 * 1.00. This constant rescales our HLTV 2.0-style output so its average lines up with FACEIT's
 * displayed baseline. It is a linear calibration heuristic, not a derived conversion: FACEIT's
 * real algorithm and HLTV's newer Rating 3.0 (round swing, eco-adjustment) both require
 * per-round telemetry (economy state, bomb status, exact kill timing) that the public FACEIT
 * Data API v4 does not expose, so an exact match to either is not achievable this way.
 *
 * Calibrated on 2026-07-29 against 30 real matches of a sample player (Rating column scraped
 * from faceit.com's own match-history page, matched 1:1 against the same matches' Kills/Deaths/
 * Assists/ADR/Rounds from the official Data API v4). The original 1.1 value overshot the real
 * displayed Rating by +0.09 on average (with the bonuses below applied) — this rescaled value
 * brought the mean error to roughly 0.
 *
 * Re-validated the same day against 180 more matches (30 each) from that player's 6 FACEIT
 * friends, scraped the same way. One friend (dimiZe) showed "---" instead of a Rating on all
 * 30 of their matches (FACEIT had no Rating computed for them) and was excluded for lack of
 * ground truth. Across the remaining 6 players / 180 matches, this scale + the 25%-weighted
 * bonuses below produced a mean bias of only +0.0003 (mean abs error ≈0.122), confirming the
 * single-player calibration generalizes rather than being an overfit to one account.
 *
 * @type {number}
 */
const FACEIT_BASELINE_SCALE = 1.03;

/**
 * Heuristic per-round-rate bonus weights for notable multi-frag rounds, as a lightweight proxy
 * for HLTV Rating 3.0's "Multi-Kill Rating" sub-component (split out from Impact in the 3.0
 * overhaul). Not derived from any published FACEIT/HLTV coefficients — chosen to nudge, not
 * dominate, the final rating.
 *
 * Scaled down to 25% of their original values on 2026-07-29: the 2026-07-29 calibration
 * (see `FACEIT_BASELINE_SCALE`) found these bonuses at full weight had *no positive* correlation
 * with the real Rating residual (multi-kill rate actually correlated negatively, r ≈ -0.31),
 * meaning they were adding inflation rather than improving accuracy. Re-validated the same day
 * on 180 more matches across 6 other players — the negative correlation held up there too
 * (double-kill rate r ≈ -0.21, quadro-kill rate r ≈ -0.22, MVP rate r ≈ -0.09). Kept at a
 * reduced weight rather than removed entirely, since even ~200 matches across 7 accounts is
 * still a small sample next to FACEIT's full player base.
 */
const MULTI_KILL_WEIGHTS = {
    double: 0.0125,
    triple: 0.0375,
    quadro: 0.0875,
    penta: 0.15,
};

/**
 * Heuristic per-round-rate weight for MVP awards (rough proxy for round-winning contribution).
 * Scaled down to 25% of its original value on 2026-07-29 — see `MULTI_KILL_WEIGHTS` comment.
 */
const MVP_RATE_WEIGHT = 0.0375;

/**
 * Heuristic per-round-rate weight for "Entry Wins" (won the opening duel of the round) — a
 * lightweight proxy for one of the situational inputs FACEIT Rating and HLTV Round Swing both
 * describe (opening picks that swing round win probability before the rest of the round plays out).
 * Scaled down to 25% of its original value on 2026-07-29 — see `MULTI_KILL_WEIGHTS` comment
 * (this specific field wasn't present in the calibration sample, but the same overweighting
 * concern applies since it uses the same heuristic derivation as the multi-kill/MVP bonuses).
 */
const ENTRY_WIN_RATE_WEIGHT = 0.03;

/**
 * Heuristic per-round-rate weights for clutch round wins (1v1 / 1v2), directly referencing the
 * "wins a 1v2 clutch" example from FACEIT's own Rating FAQ. Only available on the single-match
 * stats endpoint (`/matches/{id}/stats`), not the player game-stats endpoint.
 * Scaled down to 25% of their original values on 2026-07-29 — see `MULTI_KILL_WEIGHTS` comment.
 */
const CLUTCH_WIN_RATE_WEIGHTS = {
    v1: 0.05,
    v2: 0.10,
};

/**
 * Estimate an HLTV Rating 2.0-style per-match score using awpy's public regression formula,
 * enriched with heuristic bonuses for stats that better reflect situational impact (multi-kills,
 * MVPs, entry duel wins, clutch wins) and rescaled to FACEIT's ~1.1 baseline.
 *
 * This remains an approximation, not FACEIT's or HLTV's real proprietary rating: both use
 * per-round win-probability telemetry (economy state, bomb status, exact kill timing) that the
 * public FACEIT Data API v4 does not expose. The enrichment fields below are only available as
 * match-level *counts*, so they are applied as coarse per-round-rate bonuses on top of the base
 * regression rather than a true situational recalculation.
 *
 * Because the official FACEIT Data API v4 does not expose KAST, the function falls back
 * to a fixed community-average KAST estimate unless the caller provides a custom value.
 *
 * @param {Object} [stats={}]
 * @param {number} [stats.kills=0] Total kills in the match.
 * @param {number} [stats.deaths=0] Total deaths in the match.
 * @param {number} [stats.assists=0] Total assists in the match.
 * @param {number} [stats.rounds=0] Total rounds played in the match.
 * @param {number} [stats.adr=0] Average damage per round.
 * @param {number} [stats.kast=DEFAULT_KAST_ESTIMATE] KAST percentage on a 0-100 scale.
 * @param {number} [stats.doubleKills=0] "Double Kills" — rounds with exactly 2 kills.
 * @param {number} [stats.tripleKills=0] "Triple Kills" — rounds with exactly 3 kills.
 * @param {number} [stats.quadroKills=0] "Quadro Kills" — rounds with exactly 4 kills.
 * @param {number} [stats.pentaKills=0] "Penta Kills" — rounds with a full 5-kill ace.
 * @param {number} [stats.mvps=0] "MVPs" — rounds where the player was voted round MVP.
 * @param {number} [stats.entryWins=0] "Entry Wins" — opening duels won (match-stats endpoint only).
 * @param {number} [stats.clutch1v1Wins=0] "1v1Wins" — 1v1 clutch rounds won (match-stats endpoint only).
 * @param {number} [stats.clutch1v2Wins=0] "1v2Wins" — 1v2 clutch rounds won (match-stats endpoint only).
 * @returns {number|null} Estimated rating, or null when rounds is not a finite positive number.
 */
function estimateMatchRating({
    kills = 0,
    deaths = 0,
    assists = 0,
    rounds = 0,
    adr = 0,
    kast = DEFAULT_KAST_ESTIMATE,
    doubleKills = 0,
    tripleKills = 0,
    quadroKills = 0,
    pentaKills = 0,
    mvps = 0,
    entryWins = 0,
    clutch1v1Wins = 0,
    clutch1v2Wins = 0,
} = {}) {
    if (!Number.isFinite(rounds) || rounds <= 0) {
        return null;
    }

    const safeKills = Number.isFinite(kills) ? kills : 0;
    const safeDeaths = Number.isFinite(deaths) ? deaths : 0;
    const safeAssists = Number.isFinite(assists) ? assists : 0;
    const safeAdr = Number.isFinite(adr) ? adr : 0;
    const safeKast = Number.isFinite(kast) ? kast : DEFAULT_KAST_ESTIMATE;

    const killsPerRound = safeKills / rounds;
    const deathsPerRound = safeDeaths / rounds;
    const assistsPerRound = safeAssists / rounds;
    const impact = 2.13 * killsPerRound + 0.42 * assistsPerRound - 0.41;

    const baseRating = 0.0073 * safeKast
        + 0.3591 * killsPerRound
        - 0.5329 * deathsPerRound
        + 0.2372 * impact
        + 0.0032 * safeAdr
        + 0.1587;

    const safeDoubleKills = Number.isFinite(doubleKills) ? doubleKills : 0;
    const safeTripleKills = Number.isFinite(tripleKills) ? tripleKills : 0;
    const safeQuadroKills = Number.isFinite(quadroKills) ? quadroKills : 0;
    const safePentaKills = Number.isFinite(pentaKills) ? pentaKills : 0;
    const safeMvps = Number.isFinite(mvps) ? mvps : 0;
    const safeEntryWins = Number.isFinite(entryWins) ? entryWins : 0;
    const safeClutch1v1Wins = Number.isFinite(clutch1v1Wins) ? clutch1v1Wins : 0;
    const safeClutch1v2Wins = Number.isFinite(clutch1v2Wins) ? clutch1v2Wins : 0;

    const multiKillBonus = (
        safeDoubleKills * MULTI_KILL_WEIGHTS.double
        + safeTripleKills * MULTI_KILL_WEIGHTS.triple
        + safeQuadroKills * MULTI_KILL_WEIGHTS.quadro
        + safePentaKills * MULTI_KILL_WEIGHTS.penta
    ) / rounds;

    const mvpBonus = (safeMvps / rounds) * MVP_RATE_WEIGHT;
    const entryBonus = (safeEntryWins / rounds) * ENTRY_WIN_RATE_WEIGHT;
    const clutchBonus = (
        safeClutch1v1Wins * CLUTCH_WIN_RATE_WEIGHTS.v1
        + safeClutch1v2Wins * CLUTCH_WIN_RATE_WEIGHTS.v2
    ) / rounds;

    const enrichedRating = baseRating + multiKillBonus + mvpBonus + entryBonus + clutchBonus;

    return enrichedRating * FACEIT_BASELINE_SCALE;
}

module.exports = {
    DEFAULT_KAST_ESTIMATE,
    FACEIT_BASELINE_SCALE,
    estimateMatchRating
};
