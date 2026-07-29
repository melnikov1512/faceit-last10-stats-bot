'use strict';

// ---------------------------------------------------------------------------
// Mock all external dependencies BEFORE requiring the module under test
// ---------------------------------------------------------------------------

jest.mock('./../../src/services/storageService', () => ({
    getSubscribedChats: jest.fn(),
    getActiveMatchMessageId: jest.fn(),
    removeActiveMatch: jest.fn(),
    markFinishNotificationSentForChat: jest.fn(),
    storeActiveMatch: jest.fn(),
    markNotificationSent: jest.fn(),
}));

jest.mock('./../../src/services/telegramService', () => ({
    sendPhoto: jest.fn(),
}));

jest.mock('./../../src/services/faceitService', () => ({
    getMatchDetails: jest.fn(),
    getMatchStats: jest.fn(),
    extractPlayerMatchStats: jest.fn(() => ({})),
    getPlayerDetails: jest.fn(() => Promise.resolve(null)),
    getLastMatchEloChange: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('./../../src/services/imageService', () => ({
    generateMatchImage: jest.fn(() => Promise.resolve(Buffer.from('img'))),
    generateMatchResultsSummaryImage: jest.fn(() => Promise.resolve(Buffer.from('img'))),
}));

jest.mock('./../../src/config', () => ({
    faceit_api_key: 'test-key',
    webapp_url: null,
    bot_username: null,
}));

const storageService = require('../../src/services/storageService');
const { sendPhoto } = require('../../src/services/telegramService');
const { getMatchStats } = require('../../src/services/faceitService');
const { handleMatchFinishedEvent } = require('../../src/services/subscriptionService');

const CHAT_ID = 'chat-1';
const MATCH_ID = 'match-1';

function buildPayload() {
    return {
        id: MATCH_ID,
        teams: {
            faction1: { name: 'Team 1', roster: [{ player_id: 'p1', nickname: 'nick1' }] },
            faction2: { name: 'Team 2', roster: [{ player_id: 'p2', nickname: 'nick2' }] },
        },
        competition_name: 'Test Cup',
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    storageService.getSubscribedChats.mockResolvedValue([CHAT_ID]);
    storageService.markFinishNotificationSentForChat.mockResolvedValue(true);
    storageService.removeActiveMatch.mockResolvedValue();
    getMatchStats.mockResolvedValue({ rounds: [] });
});

// ---------------------------------------------------------------------------
// handleMatchFinishedEvent
// ---------------------------------------------------------------------------

describe('handleMatchFinishedEvent', () => {
    it('sends a reply to the original start message when its message_id is known', async () => {
        storageService.getActiveMatchMessageId.mockResolvedValue(555);

        await handleMatchFinishedEvent(buildPayload());

        expect(sendPhoto).toHaveBeenCalledTimes(1);
        const callArgs = sendPhoto.mock.calls[0];
        expect(callArgs[0]).toBe(CHAT_ID);
        expect(callArgs[4]).toBe(555);
    });

    it('sends a plain (non-reply) message when no start message_id is known', async () => {
        storageService.getActiveMatchMessageId.mockResolvedValue(null);

        await handleMatchFinishedEvent(buildPayload());

        expect(sendPhoto).toHaveBeenCalledTimes(1);
        const callArgs = sendPhoto.mock.calls[0];
        expect(callArgs[0]).toBe(CHAT_ID);
        expect(callArgs[4]).toBeFalsy();
    });

    it('reads getActiveMatchMessageId before removeActiveMatch', async () => {
        storageService.getActiveMatchMessageId.mockResolvedValue(555);
        const callOrder = [];
        storageService.getActiveMatchMessageId.mockImplementation(async () => {
            callOrder.push('getActiveMatchMessageId');
            return 555;
        });
        storageService.removeActiveMatch.mockImplementation(async () => {
            callOrder.push('removeActiveMatch');
        });

        await handleMatchFinishedEvent(buildPayload());

        expect(callOrder).toEqual(['getActiveMatchMessageId', 'removeActiveMatch']);
    });
});
