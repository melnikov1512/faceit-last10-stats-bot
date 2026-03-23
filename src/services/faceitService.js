const axios = require('axios');

const BASE_URL = 'https://open.faceit.com/data/v4';
const GAME = 'cs2'; // Counter-Strike 2

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
 * Get player match history (newest-first).
 * Each item contains team/player data including an `elo` field per player.
 */
async function getPlayerHistory(apiClient, playerId, limit = 10) {
    try {
        const response = await apiClient.get(`/players/${playerId}/history`, {
            params: { game: GAME, offset: 0, limit }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching history for player ${playerId}:`, error.message);
        return null;
    }
}

/**
 * Find a specific player's ELO inside a match history item.
 * The `elo` field represents ELO before that match was played.
 */
function findPlayerEloInMatch(matchItem, playerId) {
    for (const faction of Object.values(matchItem.teams || {})) {
        for (const player of (faction.players || [])) {
            if (player.player_id === playerId) {
                const elo = parseInt(player.elo, 10);
                return isNaN(elo) ? null : elo;
            }
        }
    }
    return null;
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
        // Get player info (contains current ELO)
        const playerInfo = await getPlayerInfo(apiClient, nickname);
        if (!playerInfo) {
            return null;
        }

        const playerId  = playerInfo.player_id;
        const currentElo = playerInfo.games?.cs2?.faceit_elo ?? null;

        // Fetch game stats and match history in parallel to avoid extra latency.
        // History gives us ELO-before-match per item; stats give us K/D, ADR, etc.
        const [statsData, historyData] = await Promise.all([
            getPlayerGameStats(apiClient, playerId, matchesCount),
            getPlayerHistory(apiClient, playerId, matchesCount)
        ]);

        if (!statsData || !statsData.items || statsData.items.length === 0) {
            return null;
        }

        const allStats = statsData.items.map(item => item.stats);
        if (allStats.length === 0) {
            return null;
        }

        // ELO change = current ELO − ELO before the oldest match in the window.
        // historyData.items is newest-first; the last item is the oldest match.
        // The `elo` field in each history item is ELO **before** that match,
        // so: delta = currentElo − history[last].elo = net change over N matches.
        let eloChange = null;
        if (historyData?.items?.length > 0 && currentElo != null) {
            const oldestMatch    = historyData.items[historyData.items.length - 1];
            const eloBeforeWindow = findPlayerEloInMatch(oldestMatch, playerId);
            if (eloBeforeWindow != null) {
                eloChange = currentElo - eloBeforeWindow;
            }
        }

        // Calculate average values
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

module.exports = {
    getLeaderboardStats,
    validatePlayer
};