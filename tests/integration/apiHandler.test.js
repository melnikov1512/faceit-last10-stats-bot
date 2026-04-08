'use strict';

jest.mock('../../src/services/storageService');
jest.mock('../../src/services/faceitService');
jest.mock('../../src/services/matchService');
jest.mock('../../src/config', () => ({ faceit_api_key: 'test-key' }));

const storageService = require('../../src/services/storageService');
const faceitService  = require('../../src/services/faceitService');
const matchService   = require('../../src/services/matchService');

const { getActiveMatches, getMatch } = require('../../src/handlers/apiHandler');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json   = jest.fn().mockReturnValue(res);
    return res;
};

/** Minimal enriched match object returned by enrichMatchWithRosterElos */
function makeEnrichedMatch(overrides = {}) {
    return {
        match_id:         'm1',
        status:           'ONGOING',
        competition_name: 'Test Cup',
        region:           'EU',
        best_of:          1,
        results:          null,
        teams: {
            faction1: { faction_id: 'f1', name: 'Team Alpha', roster: [], stats: null },
            faction2: { faction_id: 'f2', name: 'Team Beta',  roster: [], stats: null },
        },
        ...overrides,
    };
}

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// GET /api/active-matches
// ---------------------------------------------------------------------------

describe('getActiveMatches', () => {
    it('returns 400 when chatId is missing', async () => {
        const res = mockRes();
        await getActiveMatches({ query: {} }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });

    it('returns { matches: [] } when the chat has no subscriptions', async () => {
        storageService.getChatSubscriptions.mockResolvedValue([]);

        const res = mockRes();
        await getActiveMatches({ query: { chatId: '123' } }, res);

        expect(res.json).toHaveBeenCalledWith({ matches: [] });
    });

    it('returns { matches: [] } when no match IDs are found', async () => {
        storageService.getChatSubscriptions.mockResolvedValue([{ playerId: 'p1', nickname: 'player1' }]);
        matchService.collectMatchIds.mockResolvedValue([]);

        const res = mockRes();
        await getActiveMatches({ query: { chatId: '123' } }, res);

        expect(res.json).toHaveBeenCalledWith({ matches: [] });
    });

    it('returns { matches: [] } when all matches are finished', async () => {
        storageService.getChatSubscriptions.mockResolvedValue([{ playerId: 'p1', nickname: 'p' }]);
        matchService.collectMatchIds.mockResolvedValue(['m1']);
        matchService.fetchActiveMatchDetails.mockResolvedValue([]);

        const res = mockRes();
        await getActiveMatches({ query: { chatId: '123' } }, res);

        expect(res.json).toHaveBeenCalledWith({ matches: [] });
    });

    it('returns formatted active matches', async () => {
        storageService.getChatSubscriptions.mockResolvedValue([{ playerId: 'p1', nickname: 'player1' }]);
        matchService.collectMatchIds.mockResolvedValue(['m1']);
        matchService.fetchActiveMatchDetails.mockResolvedValue([{ matchId: 'm1', match: {} }]);
        faceitService.enrichMatchWithRosterElos.mockResolvedValue(makeEnrichedMatch());

        const res = mockRes();
        await getActiveMatches({ query: { chatId: '123' } }, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            matches: expect.arrayContaining([
                expect.objectContaining({ matchId: 'm1', status: 'ONGOING' }),
            ]),
        }));
    });

    it('returns 500 on an unexpected storage error', async () => {
        storageService.getChatSubscriptions.mockRejectedValue(new Error('Firestore down'));

        const res = mockRes();
        await getActiveMatches({ query: { chatId: '123' } }, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });
});

// ---------------------------------------------------------------------------
// GET /api/match
// ---------------------------------------------------------------------------

describe('getMatch', () => {
    it('returns 400 when matchId is missing', async () => {
        const res = mockRes();
        await getMatch({ query: {} }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when the match is not found', async () => {
        faceitService.getMatchDetails.mockResolvedValue(null);
        faceitService.getMatchStats.mockResolvedValue(null);
        storageService.getChatSubscriptions.mockResolvedValue([]);

        const res = mockRes();
        await getMatch({ query: { matchId: 'm999', chatId: '123' } }, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns the formatted match when found', async () => {
        const enriched = makeEnrichedMatch();
        faceitService.getMatchDetails.mockResolvedValue(enriched);
        faceitService.getMatchStats.mockResolvedValue(null);
        faceitService.enrichMatchWithRosterElos.mockResolvedValue(enriched);
        storageService.getChatSubscriptions.mockResolvedValue([]);

        const res = mockRes();
        await getMatch({ query: { matchId: 'm1', chatId: '123' } }, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            match: expect.objectContaining({ matchId: 'm1', status: 'ONGOING' }),
        }));
    });

    it('includes matchStats in the response when stats are available', async () => {
        const enriched = makeEnrichedMatch();
        faceitService.getMatchDetails.mockResolvedValue(enriched);
        faceitService.enrichMatchWithRosterElos.mockResolvedValue(enriched);
        faceitService.getMatchStats.mockResolvedValue({
            rounds: [{
                round_stats: { Map: 'de_dust2', Winner: 'f1' },
                teams: [
                    {
                        team_id: 'f1',
                        team_stats: { 'Final Score': '16' },
                        players: [{
                            player_id: 'p1',
                            nickname: 'Player1',
                            player_stats: { Kills: '20', Deaths: '10', Assists: '5', Headshots: '5', ADR: '80' },
                        }],
                    },
                    { team_id: 'f2', team_stats: { 'Final Score': '14' }, players: [] },
                ],
            }],
        });
        storageService.getChatSubscriptions.mockResolvedValue([]);

        const res = mockRes();
        await getMatch({ query: { matchId: 'm1', chatId: '123' } }, res);

        const response = res.json.mock.calls[0][0];
        expect(response.match).toHaveProperty('matchStats');
        expect(response.match.matchStats.players['p1']).toBeDefined();
    });

    it('works without chatId (subscriptions default to empty array)', async () => {
        const enriched = makeEnrichedMatch();
        faceitService.getMatchDetails.mockResolvedValue(enriched);
        faceitService.getMatchStats.mockResolvedValue(null);
        faceitService.enrichMatchWithRosterElos.mockResolvedValue(enriched);

        const res = mockRes();
        await getMatch({ query: { matchId: 'm1' } }, res); // no chatId

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            match: expect.objectContaining({ matchId: 'm1' }),
        }));
    });

    it('marks tracked players in the roster', async () => {
        const enriched = makeEnrichedMatch({
            teams: {
                faction1: {
                    faction_id: 'f1', name: 'T1',
                    roster: [{ player_id: 'p1', faceit_elo: 2000 }],
                    stats: null,
                },
                faction2: { faction_id: 'f2', name: 'T2', roster: [], stats: null },
            },
        });
        faceitService.getMatchDetails.mockResolvedValue(enriched);
        faceitService.getMatchStats.mockResolvedValue(null);
        faceitService.enrichMatchWithRosterElos.mockResolvedValue(enriched);
        storageService.getChatSubscriptions.mockResolvedValue([{ playerId: 'p1', nickname: 'TrackedOne' }]);

        const res = mockRes();
        await getMatch({ query: { matchId: 'm1', chatId: '123' } }, res);

        const roster = res.json.mock.calls[0][0].match.teams.faction1.roster;
        expect(roster[0].isTracked).toBe(true);
    });

    it('returns 500 on an unexpected error', async () => {
        faceitService.getMatchDetails.mockRejectedValue(new Error('API timeout'));
        faceitService.getMatchStats.mockRejectedValue(new Error('API timeout'));
        storageService.getChatSubscriptions.mockResolvedValue([]);

        const res = mockRes();
        await getMatch({ query: { matchId: 'm1', chatId: '123' } }, res);

        expect(res.status).toHaveBeenCalledWith(500);
    });
});
