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
 * Get user matches
 */
async function getPlayerMatches(apiClient, playerId, limit = 10) {
    try {
        const response = await apiClient.get(`/players/${playerId}/history?game=${GAME}&limit=${limit}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching matches for player ${playerId}:`, error.message);
        return null;
    }
}

/**
 * Get match stats for player
 */
async function getMatchStats(apiClient, matchId, playerId) {
    try {
        const response = await apiClient.get(`/matches/${matchId}/stats?game=${GAME}`);

        // Find specific player stats in the match
        if (response.data && response.data.rounds) {
            for (const round of response.data.rounds) {
                for (const team of [round.teams[0], round.teams[1]]) {
                    if (team) {
                        const player = team.players.find(p => p.player_id === playerId);
                        if (player) {
                            // Extract only what we need
                            return {
                                Kills: player.player_stats.Kills,
                                Deaths: player.player_stats.Deaths,
                                ADR: player.player_stats.ADR
                            };
                        }
                    }
                }
            }
        }
        return null;
    } catch (error) {
        console.error(`Error fetching stats for match ${matchId}:`, error.message);
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
        // Get player info
        const playerInfo = await getPlayerInfo(apiClient, nickname);
        if (!playerInfo) {
            return null;
        }

        const playerId = playerInfo.player_id;
        
        // Get last matches
        const matchesData = await getPlayerMatches(apiClient, playerId, matchesCount);
        if (!matchesData || !matchesData.items || matchesData.items.length === 0) {
            return null;
        }

        // Collect stats from all matches with concurrency limit
        // Limit to 5 concurrent match stats requests per player to respect rate limits
        const matchStatsResults = await processInChunks(
            matchesData.items, 
            5, 
            match => getMatchStats(apiClient, match.match_id, playerId)
        );

        const allStats = matchStatsResults.filter(stats => stats !== null);

        if (allStats.length === 0) {
            return null;
        }

        // Calculate average values
        const stats = calculateAverageStats(allStats);
        stats.nickname = nickname;
        
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
    
    // Process 3 players at a time to keep total concurrent requests manageable (3 * 5 = 15 max)
    const results = await processInChunks(
        players,
        3,
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
