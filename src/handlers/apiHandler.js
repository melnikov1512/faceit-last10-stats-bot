const storageService = require('../services/storageService');
const { getMatchDetails, enrichMatchWithRosterElos } = require('../services/faceitService');
const config = require('../config');

const MATCH_URL_BASE = 'https://www.faceit.com/en/cs2/room';

/** Statuses that mean a match is over */
const FINISHED_STATUSES = new Set(['FINISHED', 'CANCELLED', 'ABORTED', 'WALKOVER', 'DROPPED']);

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
        const [subscriptions, storedMatchIds] = await Promise.all([
            storageService.getChatSubscriptions(chatId),
            storageService.getActiveMatchIds(chatId),
        ]);

        if (!subscriptions.length) {
            return res.json({ matches: [] });
        }

        const trackedPlayerIds = new Set(subscriptions.map(s => s.playerId));
        const nicknameById = new Map(subscriptions.map(s => [s.playerId, s.nickname]));

        // Also search sent_match_notifications by playerIds (cross-chat, last 6 hours)
        const sinceTs = Math.floor(Date.now() / 1000) - 6 * 60 * 60;
        const notifMatchIds = await storageService.getRecentMatchIdsForPlayers(
            [...trackedPlayerIds],
            sinceTs
        );

        // Merge both sources, deduplicate
        const allMatchIds = [...new Set([...storedMatchIds, ...notifMatchIds])];

        console.log(`[API] Chat ${chatId}: ${subscriptions.length} subscriptions, ${storedMatchIds.length} stored + ${notifMatchIds.length} from notifications = ${allMatchIds.length} total match IDs`);

        if (!allMatchIds.length) {
            return res.json({ matches: [] });
        }

        // Fetch current status for all match IDs in parallel
        const matchDetails = await Promise.all(
            allMatchIds.map(matchId => getMatchDetails(config.faceit_api_key, matchId))
        );

        // Filter out finished matches; clean up active_matches for finished ones
        const matchMap = new Map();
        await Promise.all(matchDetails.map(async (match, i) => {
            const matchId = allMatchIds[i];
            if (!match) return;

            if (FINISHED_STATUSES.has(match.status)) {
                await storageService.removeActiveMatch(chatId, matchId);
                return;
            }

            // Only include if at least one subscribed player is in this match
            const allRosterIds = [
                ...(match.teams?.faction1?.roster || []),
                ...(match.teams?.faction2?.roster || []),
            ].map(p => p.player_id);

            const hasTrackedPlayer = allRosterIds.some(id => trackedPlayerIds.has(id));
            if (!hasTrackedPlayer) return;

            if (!matchMap.has(matchId)) {
                matchMap.set(matchId, match);
            }
        }));

        if (!matchMap.size) {
            return res.json({ matches: [] });
        }

        // Enrich each unique match with roster ELOs
        const enrichedMatches = await Promise.all(
            [...matchMap.values()].map(async (match) => {
                const enriched = await enrichMatchWithRosterElos(config.faceit_api_key, match);
                const matchId = enriched.match_id || enriched.id;

                const faction1 = enriched.teams?.faction1 || {};
                const faction2 = enriched.teams?.faction2 || {};

                const markTracked = (roster) => (roster || []).map(p => ({
                    ...p,
                    isTracked: trackedPlayerIds.has(p.player_id),
                }));

                const allRosterIds = [
                    ...(faction1.roster || []),
                    ...(faction2.roster || []),
                ].map(p => p.player_id);

                const trackedNicknames = [...new Set(
                    allRosterIds
                        .filter(id => trackedPlayerIds.has(id))
                        .map(id => nicknameById.get(id) || id)
                )];

                return {
                    matchId,
                    status: enriched.status,
                    competition_name: enriched.competition_name,
                    region: enriched.region,
                    best_of: enriched.best_of,
                    results: enriched.results || null,
                    teams: {
                        faction1: {
                            name: faction1.name,
                            stats: faction1.stats || null,
                            roster: markTracked(faction1.roster),
                        },
                        faction2: {
                            name: faction2.name,
                            stats: faction2.stats || null,
                            roster: markTracked(faction2.roster),
                        },
                    },
                    trackedPlayers: trackedNicknames,
                    matchUrl: `${MATCH_URL_BASE}/${matchId}`,
                };
            })
        );

        return res.json({ matches: enrichedMatches });
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
        const nicknameById = new Map(subscriptions.map(s => [s.playerId, s.nickname]));

        const enriched = await enrichMatchWithRosterElos(config.faceit_api_key, match);
        const resolvedMatchId = enriched.match_id || enriched.id;

        const faction1 = enriched.teams?.faction1 || {};
        const faction2 = enriched.teams?.faction2 || {};

        const markTracked = (roster) => (roster || []).map(p => ({
            ...p,
            isTracked: trackedPlayerIds.has(p.player_id),
        }));

        const allRosterIds = [
            ...(faction1.roster || []),
            ...(faction2.roster || []),
        ].map(p => p.player_id);

        const trackedNicknames = [...new Set(
            allRosterIds
                .filter(id => trackedPlayerIds.has(id))
                .map(id => nicknameById.get(id) || id)
        )];

        return res.json({
            match: {
                matchId: resolvedMatchId,
                status: enriched.status,
                competition_name: enriched.competition_name,
                region: enriched.region,
                best_of: enriched.best_of,
                results: enriched.results || null,
                teams: {
                    faction1: {
                        name: faction1.name,
                        stats: faction1.stats || null,
                        roster: markTracked(faction1.roster),
                    },
                    faction2: {
                        name: faction2.name,
                        stats: faction2.stats || null,
                        roster: markTracked(faction2.roster),
                    },
                },
                trackedPlayers: trackedNicknames,
                matchUrl: `${MATCH_URL_BASE}/${resolvedMatchId}`,
            },
        });
    } catch (error) {
        console.error('[API] Error fetching match:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { getActiveMatches, getMatch };
