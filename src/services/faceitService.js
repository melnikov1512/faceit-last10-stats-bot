const axios = require('axios');

const BASE_URL       = 'https://open.faceit.com/data/v4';
// Unofficial stats API — public endpoint, NO Authorization header allowed
const STATS_BASE_URL = 'https://api.faceit.com/stats/v1';
const GAME = 'cs2';

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

/**
 * Creates an axios instance with the provided API key
 */
function createApiClient(apiKey) {
    return axios.create({
        baseURL: BASE_URL,
        headers: {
            'Authorization': `Bearer ${apiKey}`
        }
    });
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
            from: 1604676605000,
            to:   2235828605000,
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
 * Get last N matches and player stats
 */
async function getPlayerStats(apiClient, nickname, matchesCount) {
    try {
        const playerInfo = await getPlayerInfo(apiClient, nickname);
        if (!playerInfo) return null;

        const playerId   = playerInfo.player_id;
        const currentElo = playerInfo.games?.cs2?.faceit_elo ?? null;

        // Fetch game stats and ELO timeline in parallel
        const [statsData, eloItems] = await Promise.all([
            getPlayerGameStats(apiClient, playerId, matchesCount),
            getPlayerEloTimeline(playerId, matchesCount)
        ]);

        if (!statsData?.items?.length) return null;

        const allStats = statsData.items.map(item => item.stats);
        if (!allStats.length) return null;

        // ELO change = sum of elo_delta for each match in the window.
        // This is exact and doesn't require an N+1 baseline fetch.
        let eloChange = null;
        if (Array.isArray(eloItems) && eloItems.length > 0) {
            const windowItems = eloItems.slice(0, matchesCount);
            let sum       = 0;
            let validCount = 0;
            for (const item of windowItems) {
                const delta = parseInt(item.elo_delta, 10);
                if (!isNaN(delta)) {
                    sum += delta;
                    validCount++;
                }
            }
            if (validCount > 0) eloChange = sum;
        }

        const stats = calculateAverageStats(allStats);
        stats.nickname    = nickname;
        stats.current_elo = currentElo;
        stats.elo_change  = eloChange;

        return stats;
    } catch (e) {
        console.error(`Error processing stats for ${nickname}:`, e);
        return null;
    }
}

/**
 * Main function to get leaderboard stats
 * @param {string} apiKey - FACEIT API Key
 * @param {string[]} players - List of player nicknames
 * @param {number} limit - Number of matches to analyze
 * @returns {Promise<Array>} - Sorted array of player stats
 */
async function getLeaderboardStats(apiKey, players, limit = 10) {
    if (!apiKey) {
        throw new Error('API Key is required');
    }

    // Process players with concurrency limit
    const apiClient = createApiClient(apiKey);
    
    // Process 10 players at a time to keep total concurrent requests manageable
    const results = await processInChunks(
        players,
        10,
        username => getPlayerStats(apiClient, username, limit)
    );
    
    // Filter out null results (failed requests)
    const leaderboard = results.filter(stats => stats !== null);

    // Sort by ADR descending
    return leaderboard.sort((a, b) => b.average_damage_per_round - a.average_damage_per_round);
}

/**
 * Validate if a player exists on FACEIT
 * @param {string} apiKey 
 * @param {string} nickname 
 * @returns {Promise<boolean>}
 */
async function validatePlayer(apiKey, nickname) {
    if (!apiKey) return false;
    const apiClient = createApiClient(apiKey);
    const info = await getPlayerInfo(apiClient, nickname);
    return !!info;
}

/**
 * Get a player's FACEIT player_id by nickname
 * @param {string} apiKey
 * @param {string} nickname
 * @returns {Promise<{playerId: string, nickname: string}|null>}
 */
async function getPlayerIdByNickname(apiKey, nickname) {
    if (!apiKey) return null;
    const apiClient = createApiClient(apiKey);
    const info = await getPlayerInfo(apiClient, nickname);
    if (!info) return null;
    return { playerId: info.player_id, nickname: info.nickname };
}

module.exports = {
    getLeaderboardStats,
    validatePlayer,
    getPlayerIdByNickname
};