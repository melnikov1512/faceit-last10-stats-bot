'use strict';

/**
 * Unit tests for getLeaderboardStats estimated-rating sort logic.
 *
 * axios (FACEIT v4) and global.fetch (unofficial ELO timeline endpoint)
 * are mocked so no real network calls are made.
 */

jest.mock('axios');
const axios = require('axios');

const ELO_TIMELINE_URL_FRAGMENT = 'stats/time/users';

let getLeaderboardStats;

// player_id -> { elo, avatar, statsItems: [{ matchId, kills, deaths, assists, rounds, adr }] }
let playerFixtures;

function buildStatsItems(entries) {
    return entries.map(e => {
        const stats = {
            'Match Id': e.matchId,
            Kills: String(e.kills),
            Deaths: String(e.deaths),
            Assists: String(e.assists),
            ADR: String(e.adr),
        };

        if (Object.prototype.hasOwnProperty.call(e, 'rounds')) {
            stats.Rounds = String(e.rounds);
        }

        return { stats };
    });
}

beforeAll(() => {
    axios.create.mockReturnValue({
        get: jest.fn((url) => {
            const idMatch = url.match(/\/players\/([^/]+)/);
            const playerId = idMatch ? idMatch[1] : null;
            const fixture = playerFixtures[playerId];

            if (url.endsWith(`/games/cs2/stats`) || url.includes('/games/cs2/stats')) {
                return Promise.resolve({ data: { items: buildStatsItems(fixture.statsItems) } });
            }

            return Promise.resolve({
                data: {
                    player_id: playerId,
                    avatar: fixture.avatar ?? null,
                    games: { cs2: { faceit_elo: fixture.elo ?? null } },
                },
            });
        }),
    });

    global.fetch = jest.fn((url) => {
        if (url.includes(ELO_TIMELINE_URL_FRAGMENT)) {
            return Promise.resolve({ ok: true, text: () => Promise.resolve('[]') });
        }
        return Promise.resolve({ ok: false, status: 404 });
    });

    getLeaderboardStats = require('../../src/services/faceitService').getLeaderboardStats;
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('getLeaderboardStats estimated rating sort', () => {
    it('sorts players by estimated rating descending even when ADR alone would rank them lower', async () => {
        playerFixtures = {
            p1: { elo: 2000, statsItems: [{ matchId: 'm1', kills: 25, deaths: 10, assists: 6, rounds: 16, adr: 82 }] },
            p2: { elo: 1900, statsItems: [{ matchId: 'm2', kills: 18, deaths: 16, assists: 3, rounds: 30, adr: 95 }] },
            p3: { elo: 2200, statsItems: [{ matchId: 'm3', kills: 21, deaths: 14, assists: 5, rounds: 24, adr: 88 }] },
        };

        const players = [
            { id: 'p1', nickname: 'alpha' },
            { id: 'p2', nickname: 'bravo' },
            { id: 'p3', nickname: 'charlie' },
        ];

        const result = await getLeaderboardStats('fake-api-key', players, 2);

        expect(result.map(p => p.nickname)).toEqual(['alpha', 'charlie', 'bravo']);
        expect(result[0].estimated_rating).toBeGreaterThan(result[1].estimated_rating);
        expect(result[1].estimated_rating).toBeGreaterThan(result[2].estimated_rating);
        expect(Number(result[0].average_damage_per_round)).toBeLessThan(Number(result[2].average_damage_per_round));
    });

    it('keeps current ELO and nickname fields in the sorted response', async () => {
        playerFixtures = {
            p1: { elo: 2000, statsItems: [{ matchId: 'm1', kills: 20, deaths: 15, assists: 4, rounds: 24, adr: 70 }] },
            p2: { elo: 1900, statsItems: [{ matchId: 'm2', kills: 22, deaths: 14, assists: 5, rounds: 24, adr: 95 }] },
        };

        const players = [
            { id: 'p1', nickname: 'alpha' },
            { id: 'p2', nickname: 'bravo' },
        ];

        const result = await getLeaderboardStats('fake-api-key', players, 1);

        expect(result.map(p => p.nickname)).toEqual(['bravo', 'alpha']);
        expect(result[0].current_elo).toBe(1900);
        expect(result[1].current_elo).toBe(2000);
    });

    it('averages estimated rating across multiple matches before sorting', async () => {
        playerFixtures = {
            p1: {
                elo: 2000,
                statsItems: [
                    { matchId: 'm1', kills: 20, deaths: 15, assists: 4, rounds: 24, adr: 80 },
                    { matchId: 'm2', kills: 18, deaths: 16, assists: 5, rounds: 24, adr: 70 },
                ],
            },
            p2: {
                elo: 1800,
                statsItems: [
                    { matchId: 'm3', kills: 14, deaths: 14, assists: 3, rounds: 24, adr: 90 },
                    { matchId: 'm4', kills: 16, deaths: 17, assists: 4, rounds: 24, adr: 92 },
                ],
            },
        };

        const players = [
            { id: 'p1', nickname: 'alpha' },
            { id: 'p2', nickname: 'bravo' },
        ];

        const result = await getLeaderboardStats('fake-api-key', players, 2);

        expect(result.map(p => p.nickname)).toEqual(['alpha', 'bravo']);
        expect(result[0].average_damage_per_round).toBe('75.00');
        expect(result[1].average_damage_per_round).toBe('91.00');
        expect(result[0].estimated_rating).toBeGreaterThan(result[1].estimated_rating);
    });

    it('falls back to ADR ordering when estimated rating is null', async () => {
        playerFixtures = {
            p1: { elo: 2000, statsItems: [{ matchId: 'm1', kills: 18, deaths: 12, assists: 5, rounds: 24, adr: 70 }] },
            p2: { elo: 1900, statsItems: [{ matchId: 'm2', kills: 16, deaths: 14, assists: 4, rounds: 0, adr: 95 }] },
            p3: { elo: 1800, statsItems: [{ matchId: 'm3', kills: 20, deaths: 15, assists: 6, rounds: 0, adr: 85 }] },
        };

        const players = [
            { id: 'p1', nickname: 'alpha' },
            { id: 'p2', nickname: 'bravo' },
            { id: 'p3', nickname: 'charlie' },
        ];

        const result = await getLeaderboardStats('fake-api-key', players, 1);

        expect(result.map(p => p.nickname)).toEqual(['alpha', 'bravo', 'charlie']);
        expect(result[0].estimated_rating).not.toBeNull();
        expect(result[1].estimated_rating).toBeNull();
        expect(result[2].estimated_rating).toBeNull();
        expect(result[1].average_damage_per_round).toBe('95.00');
        expect(result[2].average_damage_per_round).toBe('85.00');
    });
});
