'use strict';

// Verified live on 2026-07-28 via the official FACEIT v4 player-stats endpoint: per-match item.stats uses "Rounds" and "Assists" keys.

/**
 * Community-average KAST substitute because the official FACEIT Data API v4 does not expose real per-match KAST.
 *
 * @type {number}
 */
const DEFAULT_KAST_ESTIMATE = 73.0;

/**
 * Estimate an HLTV Rating 2.0-style per-match score using awpy's public regression formula.
 * This is an approximation of HLTV Rating 2.0, not FACEIT's proprietary rating.
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
 * @returns {number|null} Estimated rating, or null when rounds is not a finite positive number.
 */
function estimateMatchRating({
    kills = 0,
    deaths = 0,
    assists = 0,
    rounds = 0,
    adr = 0,
    kast = DEFAULT_KAST_ESTIMATE
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

    return 0.0073 * safeKast
        + 0.3591 * killsPerRound
        - 0.5329 * deathsPerRound
        + 0.2372 * impact
        + 0.0032 * safeAdr
        + 0.1587;
}

module.exports = {
    DEFAULT_KAST_ESTIMATE,
    estimateMatchRating
};
