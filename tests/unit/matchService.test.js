'use strict';

jest.mock('../../src/services/storageService');
jest.mock('../../src/services/faceitService');

const storageService = require('../../src/services/storageService');
const { getMatchDetails } = require('../../src/services/faceitService');
const { collectMatchIds, fetchActiveMatchDetails } = require('../../src/services/matchService');

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// collectMatchIds
// ---------------------------------------------------------------------------

describe('collectMatchIds', () => {
    it('merges and deduplicates IDs from both sources', async () => {
        storageService.getActiveMatchIds.mockResolvedValue(['m1', 'm2']);
        storageService.getRecentMatchIdsForPlayers.mockResolvedValue(['m2', 'm3']);

        const result = await collectMatchIds('chat1', ['p1']);

        expect(result).toHaveLength(3);
        expect(result).toEqual(expect.arrayContaining(['m1', 'm2', 'm3']));
    });

    it('returns IDs from active_matches only when notifications are empty', async () => {
        storageService.getActiveMatchIds.mockResolvedValue(['m1']);
        storageService.getRecentMatchIdsForPlayers.mockResolvedValue([]);

        const result = await collectMatchIds('chat1', ['p1']);
        expect(result).toEqual(['m1']);
    });

    it('returns IDs from notifications only when active_matches is empty', async () => {
        storageService.getActiveMatchIds.mockResolvedValue([]);
        storageService.getRecentMatchIdsForPlayers.mockResolvedValue(['m5']);

        const result = await collectMatchIds('chat1', ['p1']);
        expect(result).toEqual(['m5']);
    });

    it('returns empty array when both sources are empty', async () => {
        storageService.getActiveMatchIds.mockResolvedValue([]);
        storageService.getRecentMatchIdsForPlayers.mockResolvedValue([]);

        const result = await collectMatchIds('chat1', []);
        expect(result).toEqual([]);
    });

    it('passes the correct chatId and playerIds to storage', async () => {
        storageService.getActiveMatchIds.mockResolvedValue([]);
        storageService.getRecentMatchIdsForPlayers.mockResolvedValue([]);

        await collectMatchIds('myChatId', ['p1', 'p2']);

        expect(storageService.getActiveMatchIds).toHaveBeenCalledWith('myChatId');
        expect(storageService.getRecentMatchIdsForPlayers).toHaveBeenCalledWith(
            ['p1', 'p2'],
            expect.any(Number)
        );
    });
});

// ---------------------------------------------------------------------------
// fetchActiveMatchDetails
// ---------------------------------------------------------------------------

describe('fetchActiveMatchDetails', () => {
    beforeEach(() => {
        storageService.removeActiveMatch = jest.fn().mockResolvedValue();
    });

    it('returns active matches without trackedPlayerIds filter', async () => {
        getMatchDetails.mockResolvedValue({
            status: 'ONGOING',
            teams: { faction1: { roster: [] }, faction2: { roster: [] } },
        });

        const result = await fetchActiveMatchDetails('chat1', ['m1'], 'apiKey');

        expect(result).toHaveLength(1);
        expect(result[0].matchId).toBe('m1');
        expect(result[0].match.status).toBe('ONGOING');
    });

    it('removes and excludes a FINISHED match', async () => {
        getMatchDetails.mockResolvedValue({ status: 'FINISHED' });

        const result = await fetchActiveMatchDetails('chat1', ['m1'], 'apiKey');

        expect(result).toHaveLength(0);
        expect(storageService.removeActiveMatch).toHaveBeenCalledWith('chat1', 'm1');
    });

    it.each(['FINISHED', 'CANCELLED', 'ABORTED', 'WALKOVER', 'DROPPED'])(
        'removes and excludes a %s match',
        async (status) => {
            getMatchDetails.mockResolvedValue({ status });

            const result = await fetchActiveMatchDetails('chat1', ['m1'], 'key');

            expect(result).toHaveLength(0);
            expect(storageService.removeActiveMatch).toHaveBeenCalledWith('chat1', 'm1');
        }
    );

    it('skips null match (match not found)', async () => {
        getMatchDetails.mockResolvedValue(null);

        const result = await fetchActiveMatchDetails('chat1', ['m1'], 'apiKey');
        expect(result).toHaveLength(0);
        expect(storageService.removeActiveMatch).not.toHaveBeenCalled();
    });

    it('filters in only matches containing a tracked player', async () => {
        getMatchDetails.mockImplementation((apiKey, matchId) => {
            if (matchId === 'm1') {
                return Promise.resolve({
                    status: 'ONGOING',
                    teams: {
                        faction1: { roster: [{ player_id: 'tracked-p1' }] },
                        faction2: { roster: [] },
                    },
                });
            }
            // m2 has no tracked player
            return Promise.resolve({
                status: 'ONGOING',
                teams: {
                    faction1: { roster: [{ player_id: 'other-player' }] },
                    faction2: { roster: [] },
                },
            });
        });

        const tracked = new Set(['tracked-p1']);
        const result = await fetchActiveMatchDetails('chat1', ['m1', 'm2'], 'key', tracked);

        expect(result).toHaveLength(1);
        expect(result[0].matchId).toBe('m1');
    });

    it('returns all active matches when trackedPlayerIds is undefined', async () => {
        getMatchDetails.mockResolvedValue({
            status: 'READY',
            teams: { faction1: { roster: [{ player_id: 'any-p' }] }, faction2: { roster: [] } },
        });

        const result = await fetchActiveMatchDetails('chat1', ['m1', 'm2'], 'key', undefined);
        expect(result).toHaveLength(2);
    });

    it('handles multiple matches with mixed statuses', async () => {
        getMatchDetails
            .mockResolvedValueOnce({ status: 'ONGOING', teams: { faction1: { roster: [] }, faction2: { roster: [] } } })
            .mockResolvedValueOnce({ status: 'FINISHED' })
            .mockResolvedValueOnce({ status: 'VOTING',   teams: { faction1: { roster: [] }, faction2: { roster: [] } } });

        const result = await fetchActiveMatchDetails('chat1', ['m1', 'm2', 'm3'], 'key');

        expect(result).toHaveLength(2);
        expect(storageService.removeActiveMatch).toHaveBeenCalledTimes(1);
        expect(storageService.removeActiveMatch).toHaveBeenCalledWith('chat1', 'm2');
    });
});
