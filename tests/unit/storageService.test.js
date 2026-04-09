'use strict';

// ---------------------------------------------------------------------------
// Mock @google-cloud/firestore BEFORE requiring the module under test
// ---------------------------------------------------------------------------

const mockSet  = jest.fn().mockResolvedValue();
const mockGet  = jest.fn();
const mockDoc  = jest.fn(() => ({ set: mockSet, get: mockGet }));
const mockWhere = jest.fn();

// Minimal Timestamp stub that mirrors the real API surface used by storageService.
class MockTimestamp {
    constructor(seconds, nanoseconds) {
        this.seconds     = seconds;
        this.nanoseconds = nanoseconds;
    }
    toMillis() { return this.seconds * 1000; }
}
MockTimestamp.now = () => new MockTimestamp(Math.floor(Date.now() / 1000), 0);

class MockFirestore {
    collection() {
        return {
            doc:   mockDoc,
            where: mockWhere,
        };
    }
}
MockFirestore.Timestamp    = MockTimestamp;
MockFirestore.FieldValue   = { arrayUnion: jest.fn(), arrayRemove: jest.fn() };

jest.mock('@google-cloud/firestore', () => ({ Firestore: MockFirestore }));
jest.mock('../../src/config', () => ({ projectId: 'test-project' }));

// Now require the module – it will pick up the mock
const {
    markNotificationSent,
    markFinishNotificationSentForChat,
    getRecentMatchIdsForPlayers,
} = require('../../src/services/storageService');

// TTL constant exported indirectly — we derive the expected value from the known 7-day period
const NOTIFICATION_TTL_DAYS = 7;
const NOTIFICATION_TTL_MS   = NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000;

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// markNotificationSent
// ---------------------------------------------------------------------------

describe('markNotificationSent', () => {
    it('writes expireAt = sentAt + 7 days (±5 s tolerance)', async () => {
        const before = Math.floor((Date.now() + NOTIFICATION_TTL_MS) / 1000);

        await markNotificationSent('match-1', 'chat-1', ['player-1']);

        const after = Math.floor((Date.now() + NOTIFICATION_TTL_MS) / 1000);

        expect(mockSet).toHaveBeenCalledTimes(1);
        const payload = mockSet.mock.calls[0][0];

        expect(payload).toMatchObject({
            matchId:  'match-1',
            chatId:   'chat-1',
            playerIds: ['player-1'],
        });

        expect(payload.expireAt).toBeInstanceOf(MockTimestamp);
        expect(payload.expireAt.seconds).toBeGreaterThanOrEqual(before - 5);
        expect(payload.expireAt.seconds).toBeLessThanOrEqual(after + 5);
    });

    it('writes sentAt as a Timestamp', async () => {
        await markNotificationSent('m', 'c');

        const payload = mockSet.mock.calls[0][0];
        expect(payload.sentAt).toBeInstanceOf(MockTimestamp);
    });

    it('uses correct Firestore document ID: {matchId}_{chatId}', async () => {
        await markNotificationSent('match-X', 'chat-Y', []);

        expect(mockDoc).toHaveBeenCalledWith('match-X_chat-Y');
    });

    it('defaults playerIds to empty array when omitted', async () => {
        await markNotificationSent('m', 'c');

        const payload = mockSet.mock.calls[0][0];
        expect(payload.playerIds).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// markFinishNotificationSentForChat
// ---------------------------------------------------------------------------

describe('markFinishNotificationSentForChat', () => {
    it('writes expireAt = sentAt + 7 days (±5 s tolerance)', async () => {
        const before = Math.floor((Date.now() + NOTIFICATION_TTL_MS) / 1000);

        await markFinishNotificationSentForChat('match-2', 'chat-2', ['player-2']);

        const after = Math.floor((Date.now() + NOTIFICATION_TTL_MS) / 1000);

        const payload = mockSet.mock.calls[0][0];

        expect(payload.expireAt).toBeInstanceOf(MockTimestamp);
        expect(payload.expireAt.seconds).toBeGreaterThanOrEqual(before - 5);
        expect(payload.expireAt.seconds).toBeLessThanOrEqual(after + 5);
    });

    it('preserves type: "finish_chat"', async () => {
        await markFinishNotificationSentForChat('m', 'c', []);

        const payload = mockSet.mock.calls[0][0];
        expect(payload.type).toBe('finish_chat');
    });

    it('uses correct document ID: {matchId}_{chatId}_finish', async () => {
        await markFinishNotificationSentForChat('match-A', 'chat-B', []);

        expect(mockDoc).toHaveBeenCalledWith('match-A_chat-B_finish');
    });

    it('writes matchId, chatId and playerIds correctly', async () => {
        await markFinishNotificationSentForChat('match-3', 'chat-3', ['p1', 'p2']);

        const payload = mockSet.mock.calls[0][0];
        expect(payload).toMatchObject({
            matchId:   'match-3',
            chatId:    'chat-3',
            playerIds: ['p1', 'p2'],
        });
    });
});

// ---------------------------------------------------------------------------
// getRecentMatchIdsForPlayers — regression: expireAt field is ignored during reads
// ---------------------------------------------------------------------------

describe('getRecentMatchIdsForPlayers', () => {
    it('returns matchIds from documents that have an expireAt field (field is ignored on reads)', async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const recentTs = new MockTimestamp(nowSec, 0);
        const expireTs = new MockTimestamp(nowSec + NOTIFICATION_TTL_DAYS * 86400, 0);

        const mockSnapshot = {
            docs: [
                { data: () => ({ matchId: 'match-recent', playerIds: ['p1'], sentAt: recentTs, expireAt: expireTs }) },
            ],
        };

        // where(...).get() chain
        const mockGetSnap = jest.fn().mockResolvedValue(mockSnapshot);
        mockWhere.mockReturnValue({ get: mockGetSnap });

        const result = await getRecentMatchIdsForPlayers(['p1'], nowSec - 3600);
        expect(result).toContain('match-recent');
    });

    it('filters out documents whose sentAt is before sinceTs', async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const oldTs  = new MockTimestamp(nowSec - 10000, 0);
        const expireTs = new MockTimestamp(nowSec + 86400, 0);

        const mockSnapshot = {
            docs: [
                { data: () => ({ matchId: 'old-match', playerIds: ['p1'], sentAt: oldTs, expireAt: expireTs }) },
            ],
        };

        const mockGetSnap = jest.fn().mockResolvedValue(mockSnapshot);
        mockWhere.mockReturnValue({ get: mockGetSnap });

        // sinceTs is 1 hour ago → old-match (sentAt = ~3h ago) should be excluded
        const result = await getRecentMatchIdsForPlayers(['p1'], nowSec - 3600);
        expect(result).not.toContain('old-match');
    });
});
