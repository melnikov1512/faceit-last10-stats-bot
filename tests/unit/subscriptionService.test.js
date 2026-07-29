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
    deleteChatData: jest.fn(),
}));

jest.mock('./../../src/services/statsCache', () => ({
    invalidate: jest.fn(),
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
const { invalidate } = require('../../src/services/statsCache');
const { handleMatchEvent, handleMatchFinishedEvent } = require('../../src/services/subscriptionService');

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
    storageService.markNotificationSent.mockResolvedValue(true);
    storageService.storeActiveMatch.mockResolvedValue();
    storageService.deleteChatData.mockResolvedValue();
    getMatchStats.mockResolvedValue({ rounds: [] });
});

function build403Error() {
    const error = new Error('Forbidden: bot was kicked from the group chat');
    error.response = { status: 403 };
    return error;
}

function build500Error() {
    const error = new Error('Internal Server Error');
    error.response = { status: 500 };
    return error;
}

// ---------------------------------------------------------------------------
// handleMatchEvent
// ---------------------------------------------------------------------------

describe('handleMatchEvent', () => {
    it('deletes chat data, invalidates cache, and does not rethrow when sendPhoto rejects with 403', async () => {
        sendPhoto.mockRejectedValueOnce(build403Error());

        await expect(handleMatchEvent(buildPayload())).resolves.toBeUndefined();

        expect(storageService.deleteChatData).toHaveBeenCalledWith(CHAT_ID);
        expect(invalidate).toHaveBeenCalledWith(`${CHAT_ID}:`);
        expect(invalidate).toHaveBeenCalledWith(`activity:${CHAT_ID}:`);
    });

    it('does not run trailing per-chat logic (storeActiveMatch with messageId) after a swallowed 403', async () => {
        sendPhoto.mockRejectedValueOnce(build403Error());

        await handleMatchEvent(buildPayload());

        // storeActiveMatch is called once before sendPhoto (without messageId);
        // it must NOT be called again after sendPhoto fails with 403.
        expect(storageService.storeActiveMatch).toHaveBeenCalledTimes(1);
    });

    it('rethrows a non-403 error from sendPhoto (regression: unchanged behavior)', async () => {
        sendPhoto.mockRejectedValueOnce(build500Error());

        await expect(handleMatchEvent(buildPayload())).rejects.toMatchObject({ message: 'Internal Server Error' });
        expect(storageService.deleteChatData).not.toHaveBeenCalled();
    });
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

    it('deletes chat data, invalidates cache, and does not rethrow when sendPhoto rejects with 403', async () => {
        storageService.getActiveMatchMessageId.mockResolvedValue(555);
        sendPhoto.mockRejectedValueOnce(build403Error());

        await expect(handleMatchFinishedEvent(buildPayload())).resolves.toBeUndefined();

        expect(storageService.deleteChatData).toHaveBeenCalledWith(CHAT_ID);
        expect(invalidate).toHaveBeenCalledWith(`${CHAT_ID}:`);
        expect(invalidate).toHaveBeenCalledWith(`activity:${CHAT_ID}:`);
    });

    it('does not run trailing per-chat logic (success log) after a swallowed 403', async () => {
        storageService.getActiveMatchMessageId.mockResolvedValue(555);
        sendPhoto.mockRejectedValueOnce(build403Error());
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        await handleMatchFinishedEvent(buildPayload());

        const successLogCalled = consoleLogSpy.mock.calls.some(
            call => typeof call[0] === 'string' && call[0].includes('Finish: sent aggregated notification')
        );
        expect(successLogCalled).toBe(false);
        consoleLogSpy.mockRestore();
    });

    it('rethrows a non-403 error from sendPhoto (regression: unchanged behavior)', async () => {
        storageService.getActiveMatchMessageId.mockResolvedValue(555);
        sendPhoto.mockRejectedValueOnce(build500Error());

        await expect(handleMatchFinishedEvent(buildPayload())).rejects.toMatchObject({ message: 'Internal Server Error' });
        expect(storageService.deleteChatData).not.toHaveBeenCalled();
    });
});
