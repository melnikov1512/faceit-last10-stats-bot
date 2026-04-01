const storageService = require('../services/storageService');
const { getMatchDetails, enrichMatchWithRosterElos } = require('../services/faceitService');
const { collectMatchIds, fetchActiveMatchDetails } = require('../services/matchService');
const { MATCH_URL_BASE } = require('../constants');
const config = require('../config');

/**
 * Enrich a raw match with roster ELOs, mark tracked players, and shape the API response object.
 * @param {object} match - Raw match from FACEIT API
 * @param {Set<string>} trackedPlayerIds
 * @param {Map<string, string>} nicknameById
 * @returns {Promise<object>}
 */
async function formatMatchResponse(match, trackedPlayerIds, nicknameById) {
    const enriched = await enrichMatchWithRosterElos(config.faceit_api_key, match);
    const matchId  = enriched.match_id || enriched.id;
    const faction1 = enriched.teams?.faction1 || {};
    const faction2 = enriched.teams?.faction2 || {};

    const markTracked = (roster) => (roster || []).map(p => ({
        ...p,
        isTracked: trackedPlayerIds.has(p.player_id),
    }));

    const trackedNicknames = [...new Set(
        [...(faction1.roster || []), ...(faction2.roster || [])]
            .map(p => p.player_id)
            .filter(id => trackedPlayerIds.has(id))
            .map(id => nicknameById.get(id) || id)
    )];

    return {
        matchId,
        status:           enriched.status,
        competition_name: enriched.competition_name,
        region:           enriched.region,
        best_of:          enriched.best_of,
        results:          enriched.results || null,
        teams: {
            faction1: { name: faction1.name, stats: faction1.stats || null, roster: markTracked(faction1.roster) },
            faction2: { name: faction2.name, stats: faction2.stats || null, roster: markTracked(faction2.roster) },
        },
        trackedPlayers: trackedNicknames,
        matchUrl: `${MATCH_URL_BASE}/${matchId}`,
    };
}

/**
 * GET /api/active-matches?chatId=<chatId>
 *
 * Returns active FACEIT CS2 matches for all players subscribed in the given chat.
 *
 * Sources for match IDs (merged, deduplicated):
 * 1. active_matches Firestore collection (populated by webhook per chatId)
 * 2. sent_match_notifications searched by subscribed playerIds across ALL chats
 *    — catches matches that were notified to other chats with the same players
 *
 * FACEIT history API only returns finished matches and cannot detect ongoing ones.
 */
async function getActiveMatches(req, res) {
    const chatId = req.query.chatId;
    if (!chatId) {
        return res.status(400).json({ error: 'chatId query parameter is required' });
    }

    try {
        const subscriptions = await storageService.getChatSubscriptions(chatId);
        if (!subscriptions.length) {
            return res.json({ matches: [] });
        }

        const trackedPlayerIds = new Set(subscriptions.map(s => s.playerId));
        const nicknameById     = new Map(subscriptions.map(s => [s.playerId, s.nickname]));

        const allMatchIds = await collectMatchIds(chatId, [...trackedPlayerIds]);
        console.log(`[API] Chat ${chatId}: ${subscriptions.length} subscriptions, ${allMatchIds.length} total match IDs`);

        if (!allMatchIds.length) {
            return res.json({ matches: [] });
        }

        const activeMatches = await fetchActiveMatchDetails(chatId, allMatchIds, config.faceit_api_key, trackedPlayerIds);
        if (!activeMatches.length) {
            return res.json({ matches: [] });
        }

        const matches = await Promise.all(
            activeMatches.map(({ match }) => formatMatchResponse(match, trackedPlayerIds, nicknameById))
        );

        return res.json({ matches });
    } catch (error) {
        console.error('[API] Error fetching active matches:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

/**
 * GET /api/match?matchId=<matchId>&chatId=<chatId>
 *
 * Returns details for a single match by its ID, regardless of status (including FINISHED).
 * Marks tracked players based on chatId subscriptions.
 */
async function getMatch(req, res) {
    const { matchId, chatId } = req.query;
    if (!matchId) {
        return res.status(400).json({ error: 'matchId query parameter is required' });
    }

    try {
        const [match, subscriptions] = await Promise.all([
            getMatchDetails(config.faceit_api_key, matchId),
            chatId ? storageService.getChatSubscriptions(chatId) : Promise.resolve([]),
        ]);

        if (!match) {
            return res.status(404).json({ error: 'Match not found' });
        }

        const trackedPlayerIds = new Set(subscriptions.map(s => s.playerId));
        const nicknameById     = new Map(subscriptions.map(s => [s.playerId, s.nickname]));

        const formatted = await formatMatchResponse(match, trackedPlayerIds, nicknameById);
        return res.json({ match: formatted });
    } catch (error) {
        console.error('[API] Error fetching match:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { getActiveMatches, getMatch };
