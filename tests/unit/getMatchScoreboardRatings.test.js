'use strict';

/**
 * Unit tests for getMatchScoreboardRatings (unofficial FACEIT scoreboard API).
 * We mock global fetch since the function uses native fetch, not axios.
 */

// Grab the function under test — it's not exported by default, so we need to
// require the whole module and use module-level mocking of fetch.
let getMatchScoreboardRatings;

// Helper: build a minimal scoreboard-summary response payload
function makePayload(players1 = [], players2 = []) {
    return {
        payload: {
            id: 'match-1',
            game: 'cs2',
            matchRoundNumber: 1,
            cs2: {
                mvpPlayerId: 'p1',
                teams: [
                    { teamId: 'team-a', score: 16, players: players1 },
                    { teamId: 'team-b', score: 14, players: players2 },
                ],
            },
        },
    };
}

function makePlayers(entries) {
    // entries: [{ playerId, faceitRating }]
    return entries.map(e => ({
        playerId: e.playerId,
        stats: { faceitRating: e.faceitRating, kills: 20, deaths: 10, adr: 80 },
    }));
}

beforeAll(() => {
    // Import AFTER we can intercept fetch
    getMatchScoreboardRatings = require('../../src/services/faceitService').getMatchScoreboardRatings;
});

afterEach(() => {
    jest.restoreAllMocks();
    global.fetch && jest.spyOn(global, 'fetch').mockRestore?.();
});

describe('getMatchScoreboardRatings', () => {
    it('returns a Map of playerId → faceitRating for bo1', async () => {
        const payload = makePayload(
            makePlayers([{ playerId: 'p1', faceitRating: 1.25 }, { playerId: 'p2', faceitRating: 0.85 }]),
            makePlayers([{ playerId: 'p3', faceitRating: 1.10 }])
        );
        global.fetch = jest.fn().mockResolvedValue({
            ok:   true,
            json: () => Promise.resolve(payload),
        });

        const result = await getMatchScoreboardRatings('match-1', 1);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.get('p1')).toBeCloseTo(1.25);
        expect(result.get('p2')).toBeCloseTo(0.85);
        expect(result.get('p3')).toBeCloseTo(1.10);
    });

    it('averages rating across multiple rounds for bo3', async () => {
        const round1 = makePayload(makePlayers([{ playerId: 'p1', faceitRating: 1.20 }]), []);
        const round2 = makePayload(makePlayers([{ playerId: 'p1', faceitRating: 1.00 }]), []);
        const round3 = makePayload(makePlayers([{ playerId: 'p1', faceitRating: 1.40 }]), []);

        let callCount = 0;
        global.fetch = jest.fn().mockImplementation(() => {
            callCount++;
            const data = [round1, round2, round3][callCount - 1];
            return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
        });

        const result = await getMatchScoreboardRatings('match-1', 3);

        expect(global.fetch).toHaveBeenCalledTimes(3);
        // Average of 1.20, 1.00, 1.40 = 1.20
        expect(result.get('p1')).toBeCloseTo(1.20);
    });

    it('returns an empty Map when the API returns a non-ok response', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

        const result = await getMatchScoreboardRatings('match-1', 1);

        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
    });

    it('returns an empty Map when fetch throws', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

        const result = await getMatchScoreboardRatings('match-1', 1);

        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
    });

    it('skips a player whose faceitRating field is missing', async () => {
        const payload = makePayload(
            [{ playerId: 'p1', stats: { kills: 20 } }], // no faceitRating
            makePlayers([{ playerId: 'p2', faceitRating: 1.05 }])
        );
        global.fetch = jest.fn().mockResolvedValue({
            ok:   true,
            json: () => Promise.resolve(payload),
        });

        const result = await getMatchScoreboardRatings('match-1', 1);

        expect(result.has('p1')).toBe(false);
        expect(result.get('p2')).toBeCloseTo(1.05);
    });

    it('handles a round with no teams gracefully', async () => {
        const payload = { payload: { cs2: { teams: null } } };
        global.fetch = jest.fn().mockResolvedValue({
            ok:   true,
            json: () => Promise.resolve(payload),
        });

        const result = await getMatchScoreboardRatings('match-1', 1);

        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
    });

    it('limits rounds to 5 even if bestOf > 5', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok:   true,
            json: () => Promise.resolve(makePayload([], [])),
        });

        await getMatchScoreboardRatings('match-1', 10);

        expect(global.fetch).toHaveBeenCalledTimes(5);
    });
});
