const axios = require('axios');

const BASE_URL       = 'https://open.faceit.com/data/v4';
// Unofficial stats API — public endpoint, NO Authorization header allowed
const STATS_BASE_URL = 'https://api.faceit.com/stats/v1';
const GAME = 'cs2';

// Wide time range for ELO timeline queries — known to work (from FACEIT Discord community).
// from: 2020-11-06 (CS2/CSGO FACEIT era start), to: ~2040 (far future)
const ELO_TIMELINE_FROM_TS = 1604676605000;
const ELO_TIMELINE_TO_TS   = 2235828605000;

/**
 * Helper to process items in chunks to avoid hitting API rate limits
 */
async function processInChunks(items, chunkSize, processFn) {
    const results = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(processFn));
        results.push(...chunkResults);
    }
    return results;
}

// Single shared axios instance — API key is constant for the lifetime of the process
let _apiClient = null;

function getApiClient(apiKey) {
    if (!_apiClient) {
        _apiClient = axios.create({
            baseURL: BASE_URL,
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 15000,
        });
    }
    return _apiClient;
}

/**
 * Get user info by nickname
 */
async function getPlayerInfo(apiClient, nickname) {
    try {
        const response = await apiClient.get('/players', {
            params: { nickname, game: GAME }
        });
        return response.data;
    } catch (error) {
        if (error.response?.status === 404) {
            console.error(`Player "${nickname}" not found on FACEIT`);
        } else if (error.response?.status === 401 || error.response?.status === 403) {
            console.error(`\n❌ ERROR: API key unauthorized for ${nickname}!`);
        } else {
            console.error(`Error fetching user info for ${nickname}:`, error.message);
        }
        return null;
    }
}

/**
 * Get user info by FACEIT player ID.
 * Preferred over nickname lookup — more reliable and faster.
 */
async function getPlayerInfoById(apiClient, playerId) {
    try {
        const response = await apiClient.get(`/players/${playerId}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching player info for id ${playerId}:`, error.message);
        return null;
    }
}

/**
 * Get player stats for a game (CS2)
 * This endpoint returns the last N matches with stats directly.
 */
async function getPlayerGameStats(apiClient, playerId, limit = 10) {
    try {
        const response = await apiClient.get(`/players/${playerId}/games/${GAME}/stats`, {
            params: { limit }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching game stats for player ${playerId}:`, error.message);
        return null;
    }
}

/**
 * Fetch per-match ELO timeline from the unofficial FACEIT stats API.
 *
 * MUST use Node.js built-in fetch (undici TLS stack) — axios is blocked by Cloudflare.
 * Each item contains `elo` (ELO after match) and `elo_delta` (change for that match).
 * Returns newest-first array.
 */
async function getPlayerEloTimeline(playerId, limit) {
    try {
        // Wide time range known to work (from FACEIT Discord community)
        const params = new URLSearchParams({
            size: limit,
            page: 0,
            from: ELO_TIMELINE_FROM_TS,
            to:   ELO_TIMELINE_TO_TS,
        });
        const url = `${STATS_BASE_URL}/stats/time/users/${playerId}/games/${GAME}?${params}`;

        // fetch (undici) has a different TLS fingerprint than axios — passes Cloudflare
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'PostmanRuntime/7.43.0',
                'Accept':     '*/*',
            },
        });

        if (!res.ok) {
            console.error(`ELO timeline HTTP ${res.status} for player ${playerId}`);
            return null;
        }

        const text = await res.text();
        let items;
        try {
            const parsed = JSON.parse(text);
            items = Array.isArray(parsed) ? parsed : (parsed?.payload ?? null);
        } catch (_) {
            return null;
        }

        if (!Array.isArray(items) || items.length === 0) return null;

        // Sort newest-first by created_at (ms timestamp in each item)
        items.sort((a, b) => Number(b.created_at) - Number(a.created_at));

        return items;
    } catch (error) {
        console.error(`Error fetching ELO timeline for player ${playerId}:`, error.message);
        return null;
    }
}

/**
 * Calculate average stats
 */
function calculateAverageStats(statsArray) {
    if (statsArray.length === 0) {
        return {};
    }

    let totalKills = 0;
    let totalDeaths = 0;
    let totalADR = 0;

    for (const stat of statsArray) {
        totalKills += parseInt(stat.Kills) || 0;
        totalDeaths += parseInt(stat.Deaths) || 0;
        totalADR += parseFloat(stat.ADR) || 0;
    }

    const matchCount = statsArray.length;
    
    const kd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills.toFixed(2);
    const avgADR = (totalADR / matchCount).toFixed(2);
    const avgKills = (totalKills / matchCount).toFixed(2);

    return {
        kills_deaths_ratio: kd,
        average_damage_per_round: avgADR,
        average_kills: avgKills,
        matchesAnalyzed: matchCount
    };
}

/**
 * Get last N matches and player stats.
 * Accepts a player object { id, nickname } — uses id directly,
 * fetching player info, game stats, and ELO timeline in parallel.
 * @param {object} player - { id: string, nickname: string }
 */
async function getPlayerStats(apiClient, player, matchesCount) {
    const { id: playerId, nickname } = player;
    try {
        // All three requests fire in parallel — faster than the old sequential approach
        const [playerInfo, statsData, eloItems] = await Promise.all([
            getPlayerInfoById(apiClient, playerId),
            getPlayerGameStats(apiClient, playerId, matchesCount),
            getPlayerEloTimeline(playerId, matchesCount),
        ]);

        const currentElo = playerInfo?.games?.cs2?.faceit_elo ?? null;

        if (!statsData?.items?.length) return null;

        const allStats = statsData.items.map(item => item.stats);
        if (!allStats.length) return null;

        let eloChange = null;
        if (Array.isArray(eloItems) && eloItems.length > 0) {
            const windowItems = eloItems.slice(0, matchesCount);
            let sum = 0;
            let validCount = 0;
            for (const item of windowItems) {
                const delta = parseInt(item.elo_delta, 10);
                if (!isNaN(delta)) { sum += delta; validCount++; }
            }
            if (validCount > 0) eloChange = sum;
        }

        const stats = calculateAverageStats(allStats);
        stats.nickname    = nickname;
        stats.current_elo = currentElo;
        stats.elo_change  = eloChange;
        stats.avatar_url  = playerInfo?.avatar ?? null;

        return stats;
    } catch (e) {
        console.error(`Error processing stats for ${nickname}:`, e);
        return null;
    }
}

/**
 * Main function to get leaderboard stats.
 * @param {string} apiKey
 * @param {Array<{ id: string, nickname: string }>} players
 * @param {number} limit
 * @returns {Promise<Array>} Sorted array of player stats
 */
async function getLeaderboardStats(apiKey, players, limit = 10) {
    if (!apiKey) {
        throw new Error('API Key is required');
    }

    // Process players with concurrency limit
    const apiClient = getApiClient(apiKey);
    
    // Process 10 players at a time to keep total concurrent requests manageable
    const results = await processInChunks(
        players,
        10,
        player => getPlayerStats(apiClient, player, limit)
    );
    
    // Filter out null results (failed requests)
    const leaderboard = results.filter(stats => stats !== null);

    // Sort by ADR descending
    return leaderboard.sort((a, b) => b.average_damage_per_round - a.average_damage_per_round);
}

/**
 * Get enriched player details (avatar, ELO, skill level) by player ID.
 * @param {string} apiKey
 * @param {string} playerId
 * @returns {Promise<{playerId, nickname, avatar, elo, skillLevel}|null>}
 */
async function getPlayerDetails(apiKey, playerId) {
    if (!apiKey || !playerId) return null;
    const apiClient = getApiClient(apiKey);
    const info = await getPlayerInfoById(apiClient, playerId);
    if (!info) return null;
    return {
        playerId:   info.player_id,
        nickname:   info.nickname,
        avatar:     info.avatar || null,
        elo:        info.games?.cs2?.faceit_elo ?? null,
        skillLevel: info.games?.cs2?.skill_level ?? null,
    };
}

/**
 * Get enriched player details by nickname (single API call).
 * @param {string} apiKey
 * @param {string} nickname
 * @returns {Promise<{playerId, nickname, avatar, elo, skillLevel}|null>}
 */
async function getPlayerDetailsByNickname(apiKey, nickname) {
    if (!apiKey) return null;
    const apiClient = getApiClient(apiKey);
    const info = await getPlayerInfo(apiClient, nickname);
    if (!info) return null;
    return {
        playerId:   info.player_id,
        nickname:   info.nickname,
        avatar:     info.avatar || null,
        elo:        info.games?.cs2?.faceit_elo ?? null,
        skillLevel: info.games?.cs2?.skill_level ?? null,
    };
}

/**
 * Fetch match details by match ID from FACEIT Data API v4.
 * Used to retrieve roster when webhook payload lacks team data.
 * @param {string} apiKey
 * @param {string} matchId
 * @returns {Promise<object|null>}
 */
async function getMatchDetails(apiKey, matchId) {
    if (!apiKey || !matchId) return null;
    const apiClient = getApiClient(apiKey);
    try {
        const response = await apiClient.get(`/matches/${matchId}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching match details for ${matchId}:`, error.message);
        return null;
    }
}

/**
 * Fetch per-player statistics for a finished match.
 * Returns null for ongoing matches (404) or on error.
 * @param {string} apiKey
 * @param {string} matchId
 * @returns {Promise<object|null>} Raw FACEIT stats: { rounds: [...] }
 */
async function getMatchStats(apiKey, matchId) {
    if (!apiKey || !matchId) return null;
    const apiClient = getApiClient(apiKey);
    try {
        const response = await apiClient.get(`/matches/${matchId}/stats`);
        return response.data;
    } catch (error) {
        if (error.response?.status !== 404) {
            console.error(`Error fetching match stats for ${matchId}:`, error.message);
        }
        return null;
    }
}

/**
 * Extract a single player's stats from a FACEIT match stats response.
 * Looks through rounds[0].teams[].players[] for a matching player_id.
 * @param {object} matchStats  Response from GET /matches/{id}/stats
 * @param {string} playerId
 * @returns {{ kills, deaths, assists, kd, adr, hsPercent, result, map, teamScore, opponentScore }|null}
 */
function extractPlayerMatchStats(matchStats, playerId) {
    if (!matchStats?.rounds?.length) return null;
    const round = matchStats.rounds[0];
    const map   = round.round_stats?.Map ?? null;
    const teams = round.teams || [];

    for (let i = 0; i < teams.length; i++) {
        const team   = teams[i];
        const player = (team.players || []).find(p => p.player_id === playerId);
        if (player) {
            const s            = player.player_stats || {};
            const opponentTeam = teams[i === 0 ? 1 : 0];

            const rawTeam = parseInt(team.team_stats?.['Final Score'] ?? team.team_stats?.final_score, 10);
            const rawOpp  = parseInt(opponentTeam?.team_stats?.['Final Score'] ?? opponentTeam?.team_stats?.final_score, 10);

            return {
                kills:         parseInt(s['Kills'], 10)        || 0,
                deaths:        parseInt(s['Deaths'], 10)       || 0,
                assists:       parseInt(s['Assists'], 10)      || 0,
                kd:            parseFloat(s['K/D Ratio'])      || 0,
                adr:           parseFloat(s['ADR'])            || 0,
                hsPercent:     parseInt(s['Headshots %'], 10)  || 0,
                result:        parseInt(s['Result'], 10),        // 1 = win, 0 = loss
                map,
                teamScore:     isNaN(rawTeam) ? null : rawTeam,
                opponentScore: isNaN(rawOpp)  ? null : rawOpp,
            };
        }
    }
    return null;
}

/**
 * Fetch the ELO delta for the player's most recent match from the unofficial ELO timeline.
 * @param {string} playerId
 * @returns {Promise<number|null>}
 */
async function getLastMatchEloChange(playerId) {
    const items = await getPlayerEloTimeline(playerId, 1);
    if (!items?.length) return null;
    const delta = parseInt(items[0].elo_delta, 10);
    return isNaN(delta) ? null : delta;
}

/**
 * Enrich a match object's rosters with each player's current ELO and skill level.
 * Fetches all roster players in parallel (chunked).
 * @param {string} apiKey
 * @param {object} match  - Raw match object from FACEIT API
 * @returns {Promise<object>} Match with enriched roster entries
 */
async function enrichMatchWithRosterElos(apiKey, match) {
    if (!match) return match;
    const apiClient = getApiClient(apiKey);

    const faction1 = match?.teams?.faction1 || {};
    const faction2 = match?.teams?.faction2 || {};
    const allPlayers = [...(faction1.roster || []), ...(faction2.roster || [])];

    const playerInfos = await processInChunks(allPlayers, 10, async (player) => {
        const info = await getPlayerInfoById(apiClient, player.player_id);
        return {
            player_id: player.player_id,
            faceit_elo: info?.games?.cs2?.faceit_elo ?? null,
            skill_level: info?.games?.cs2?.skill_level ?? null,
        };
    });

    const eloMap = new Map(playerInfos.map(p => [p.player_id, p]));

    const enrichRoster = (roster) => (roster || []).map(p => ({
        ...p,
        faceit_elo: eloMap.get(p.player_id)?.faceit_elo ?? null,
        skill_level: eloMap.get(p.player_id)?.skill_level ?? null,
    }));

    return {
        ...match,
        teams: {
            faction1: { ...faction1, roster: enrichRoster(faction1.roster) },
            faction2: { ...faction2, roster: enrichRoster(faction2.roster) },
        },
    };
}

module.exports = {
    getLeaderboardStats,
    getPlayerDetails,
    getPlayerDetailsByNickname,
    getMatchDetails,
    getMatchStats,
    extractPlayerMatchStats,
    getLastMatchEloChange,
    enrichMatchWithRosterElos,
};