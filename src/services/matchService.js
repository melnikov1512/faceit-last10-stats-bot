const storageService = require('./storageService');
const { getMatchDetails } = require('./faceitService');
const { FINISHED_STATUSES } = require('../constants');

const ACTIVE_MATCH_WINDOW_SEC = 6 * 60 * 60; // 6 hours

/**
 * Collect all candidate match IDs for a chat from two sources:
 *  1. active_matches Firestore collection (written on each webhook notification)
 *  2. sent_match_notifications for the chat's tracked playerIds (cross-chat fallback)
 *
 * @param {string} chatId
 * @param {string[]} trackedPlayerIds
 * @returns {Promise<string[]>} Deduplicated match IDs
 */
async function collectMatchIds(chatId, trackedPlayerIds) {
    const sinceTs = Math.floor(Date.now() / 1000) - ACTIVE_MATCH_WINDOW_SEC;
    const [storedIds, notifIds] = await Promise.all([
        storageService.getActiveMatchIds(chatId),
        storageService.getRecentMatchIdsForPlayers(trackedPlayerIds, sinceTs),
    ]);
    return [...new Set([...storedIds, ...notifIds])];
}

/**
 * Fetch and filter active (non-finished) match details for a list of match IDs.
 * Removes finished matches from storage as a side effect.
 *
 * @param {string} chatId
 * @param {string[]} matchIds
 * @param {string} apiKey
 * @param {Set<string>} [trackedPlayerIds] - If provided, only matches containing a tracked player are returned
 * @returns {Promise<Array<{ matchId: string, match: object }>>}
 */
async function fetchActiveMatchDetails(chatId, matchIds, apiKey, trackedPlayerIds) {
    const details = await Promise.all(
        matchIds.map(matchId => getMatchDetails(apiKey, matchId))
    );

    const active = [];
    await Promise.all(details.map(async (match, i) => {
        const matchId = matchIds[i];
        if (!match) return;

        if (FINISHED_STATUSES.has(match.status)) {
            await storageService.removeActiveMatch(chatId, matchId);
            return;
        }

        if (trackedPlayerIds) {
            const allRosterIds = [
                ...(match.teams?.faction1?.roster || []),
                ...(match.teams?.faction2?.roster || []),
            ].map(p => p.player_id);
            if (!allRosterIds.some(id => trackedPlayerIds.has(id))) return;
        }

        active.push({ matchId, match });
    }));

    return active;
}

module.exports = { collectMatchIds, fetchActiveMatchDetails };
