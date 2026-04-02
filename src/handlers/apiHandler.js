const storageService = require('../services/storageService');
const { getMatchDetails, enrichMatchWithRosterElos, getMatchStats } = require('../services/faceitService');
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
 * Process raw FACEIT match stats into a frontend-friendly format.
 * Aggregates per-player stats across all maps (rounds) and extracts map scores.
 *
 * @param {object} statsData  - Raw stats from FACEIT: { rounds: [...] }
 * @param {string} faction1Id - faction_id of faction1 from match details
 * @param {string} faction2Id - faction_id of faction2 from match details
 * @returns {{ maps: Array, players: Object }|null}
 */
function processMatchStats(statsData, faction1Id, faction2Id) {
    if (!statsData?.rounds?.length) return null;

    const factionById = {};
    if (faction1Id) factionById[faction1Id] = 'faction1';
    if (faction2Id) factionById[faction2Id] = 'faction2';

    const maps = [];
    const accumulator = {}; // player_id -> running totals

    for (const round of statsData.rounds) {
        const rs = round.round_stats || {};
        const mapName = rs['Map'] || 'Unknown';
        const winnerTeamId = rs['Winner'] || null;
        const mapWinner = winnerTeamId ? (factionById[winnerTeamId] || null) : null;

        let f1Score = null;
        let f2Score = null;

        for (const team of round.teams || []) {
            const factionKey = factionById[team.team_id] || null;
            const ts = team.team_stats || {};
            const score = parseInt(ts['Final Score'] ?? ts['final_score'] ?? 0, 10);
            if (factionKey === 'faction1') f1Score = score;
            else if (factionKey === 'faction2') f2Score = score;

            for (const player of team.players || []) {
                const pid = player.player_id;
                if (!accumulator[pid]) {
                    accumulator[pid] = {
                        nickname: player.nickname,
                        faction: factionKey,
                        kills: 0, deaths: 0, assists: 0, headshots: 0,
                        adr_sum: 0, maps_played: 0,
                    };
                }
                const ps = player.player_stats || {};
                accumulator[pid].kills     += parseInt(ps['Kills']     || 0, 10);
                accumulator[pid].deaths    += parseInt(ps['Deaths']    || 0, 10);
                accumulator[pid].assists   += parseInt(ps['Assists']   || 0, 10);
                accumulator[pid].headshots += parseInt(ps['Headshots'] || 0, 10);
                accumulator[pid].adr_sum   += parseFloat(ps['ADR']    || 0);
                accumulator[pid].maps_played++;
            }
        }

        maps.push({ map: mapName, f1_score: f1Score, f2_score: f2Score, winner: mapWinner });
    }

    const players = {};
    for (const [pid, p] of Object.entries(accumulator)) {
        const kd      = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
        const adr     = p.maps_played > 0 ? (p.adr_sum / p.maps_played).toFixed(1) : '0.0';
        const hs_pct  = p.kills > 0 ? Math.round((p.headshots / p.kills) * 100) : 0;
        players[pid]  = { nickname: p.nickname, faction: p.faction, kills: p.kills, deaths: p.deaths, assists: p.assists, kd, adr, hs_pct };
    }

    return { maps, players };
}

/**
 * GET /api/active-matches?chatId=<chatId>
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
        const [match, subscriptions, rawStats] = await Promise.all([
            getMatchDetails(config.faceit_api_key, matchId),
            chatId ? storageService.getChatSubscriptions(chatId) : Promise.resolve([]),
            getMatchStats(config.faceit_api_key, matchId),
        ]);

        if (!match) {
            return res.status(404).json({ error: 'Match not found' });
        }

        const trackedPlayerIds = new Set(subscriptions.map(s => s.playerId));
        const nicknameById     = new Map(subscriptions.map(s => [s.playerId, s.nickname]));

        const formatted = await formatMatchResponse(match, trackedPlayerIds, nicknameById);

        if (rawStats) {
            const faction1Id = match.teams?.faction1?.faction_id;
            const faction2Id = match.teams?.faction2?.faction_id;
            const stats = processMatchStats(rawStats, faction1Id, faction2Id);
            if (stats) {
                // Propagate isTracked flag into stats players
                for (const [pid, p] of Object.entries(stats.players)) {
                    p.isTracked = trackedPlayerIds.has(pid);
                }
                formatted.matchStats = stats;
            }
        }

        return res.json({ match: formatted });
    } catch (error) {
        console.error('[API] Error fetching match:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = { getActiveMatches, getMatch };
