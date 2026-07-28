'use strict';

/**
 * Unit tests for getLeaderboardStats' hybrid sort logic:
 * 1. Players WITH avg_faceit_rating come first, sorted by rating DESC,
 *    then ADR DESC as a tiebreaker when ratings are equal.
 * 2. Players WITHOUT rating (API miss / not yet computed) are appended
 *    at the end, sorted by ADR DESC.
 *
 * axios (FACEIT v4) and global.fetch (unofficial match-rounds + ELO timeline
 * endpoints) are both mocked so no real network calls are made.
 */

jest.mock('axios');
const axios = require('axios');

const MATCH_ROUNDS_URL_FRAGMENT = 'match-rounds';
const ELO_TIMELINE_URL_FRAGMENT = 'stats/time/users';

let getLeaderboardStats;

// player_id -> { elo, avatar, statsItems: [{ matchId, kills, deaths, adr }], matchRounds: [{ matchId, faceitRating }] }
let playerFixtures;

function buildStatsItems(entries) {
    return entries.map(e => ({
        stats: {
            'Match Id': e.matchId,
            Kills:      String(e.kills),
            Deaths:     String(e.deaths),
            ADR:        String(e.adr),
        },
    }));
}

beforeAll(() => {
    axios.create.mockReturnValue({
        get: jest.fn((url) => {
            const idMatch = url.match(/\/players\/([^/]+)/);
            const playerId = idMatch ? idMatch[1] : null;
            const fixture  = playerFixtures[playerId];

            if (url.endsWith(`/games/cs2/stats`) || url.includes('/games/cs2/stats')) {
                return Promise.resolve({ data: { items: buildStatsItems(fixture.statsItems) } });
            }
            // GET /players/{id} — player info
            return Promise.resolve({
                data: {
                    player_id: playerId,
                    avatar:    fixture.avatar ?? null,
                    games:     { cs2: { faceit_elo: fixture.elo ?? null } },
                },
            });
        }),
    });

    global.fetch = jest.fn((url) => {
        const idMatch  = url.match(/\/players\/([^/]+)\//) || url.match(/users\/([^/]+)\//);
        const playerId = idMatch ? idMatch[1] : null;
        const fixture   = playerFixtures[playerId];

        if (url.includes(MATCH_ROUNDS_URL_FRAGMENT)) {
            return Promise.resolve({
                ok:   true,
                json: () => Promise.resolve({ payload: { cs2: { matchRounds: fixture.matchRounds } } }),
            });
        }
        if (url.includes(ELO_TIMELINE_URL_FRAGMENT)) {
            // No ELO delta data needed for these tests
            return Promise.resolve({ ok: true, text: () => Promise.resolve('[]') });
        }
        return Promise.resolve({ ok: false, status: 404 });
    });

    getLeaderboardStats = require('../../src/services/faceitService').getLeaderboardStats;
});

afterEach(() => {
    jest.clearAllMocks();
});

describe('getLeaderboardStats hybrid sort', () => {
    it('sorts rated players by rating DESC, tiebreaks by ADR DESC, and appends unrated players sorted by ADR DESC', async () => {
        playerFixtures = {
            p1: { // alpha: rating 1.30, ADR 80
                elo: 2000,
                statsItems:  [{ matchId: 'm1', kills: 20, deaths: 15, adr: 80 }],
                matchRounds: [{ matchId: 'm1', faceitRating: 1.30 }],
            },
            p2: { // bravo: rating 1.30 (tie with alpha), ADR 90 -> should rank ABOVE alpha
                elo: 1900,
                statsItems:  [{ matchId: 'm2', kills: 22, deaths: 14, adr: 90 }],
                matchRounds: [{ matchId: 'm2', faceitRating: 1.30 }],
            },
            p3: { // charlie: no rating at all, highest ADR -> must be appended at the end
                elo: 2200,
                statsItems:  [{ matchId: 'm3', kills: 25, deaths: 10, adr: 100 }],
                matchRounds: [],
            },
            p4: { // delta: highest rating -> must be first
                elo: 1800,
                statsItems:  [{ matchId: 'm4', kills: 15, deaths: 15, adr: 50 }],
                matchRounds: [{ matchId: 'm4', faceitRating: 1.50 }],
            },
        };

        const players = [
            { id: 'p1', nickname: 'alpha' },
            { id: 'p2', nickname: 'bravo' },
            { id: 'p3', nickname: 'charlie' },
            { id: 'p4', nickname: 'delta' },
        ];

        const result = await getLeaderboardStats('fake-api-key', players, 2);

        expect(result.map(p => p.nickname)).toEqual(['delta', 'bravo', 'alpha', 'charlie']);

        expect(result[0].avg_faceit_rating).toBeCloseTo(1.50);
        expect(result[1].avg_faceit_rating).toBeCloseTo(1.30);
        expect(result[2].avg_faceit_rating).toBeCloseTo(1.30);
        expect(result[3].avg_faceit_rating).toBeNull();
        expect(result[3].faceit_rating_matches).toBe(0);
    });

    it('falls back to pure ADR sort when no player has rating data', async () => {
        playerFixtures = {
            p1: { elo: 2000, statsItems: [{ matchId: 'm1', kills: 20, deaths: 15, adr: 70 }], matchRounds: [] },
            p2: { elo: 1900, statsItems: [{ matchId: 'm2', kills: 22, deaths: 14, adr: 95 }], matchRounds: [] },
        };

        const players = [
            { id: 'p1', nickname: 'alpha' },
            { id: 'p2', nickname: 'bravo' },
        ];

        const result = await getLeaderboardStats('fake-api-key', players, 1);

        expect(result.map(p => p.nickname)).toEqual(['bravo', 'alpha']);
        expect(result.every(p => p.avg_faceit_rating === null)).toBe(true);
    });

    it('computes faceit_rating_matches as the count of matches that had a rating (partial coverage)', async () => {
        playerFixtures = {
            p1: {
                elo: 2000,
                statsItems: [
                    { matchId: 'm1', kills: 20, deaths: 15, adr: 80 },
                    { matchId: 'm2', kills: 18, deaths: 16, adr: 70 },
                ],
                // Only m1 has a computed rating — m2 is "not yet processed" by FACEIT
                matchRounds: [{ matchId: 'm1', faceitRating: 1.10 }],
            },
        };

        const players = [{ id: 'p1', nickname: 'alpha' }];

        const result = await getLeaderboardStats('fake-api-key', players, 2);

        expect(result[0].avg_faceit_rating).toBeCloseTo(1.10);
        expect(result[0].faceit_rating_matches).toBe(1);
    });
});
