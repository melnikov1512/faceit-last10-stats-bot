'use strict';

jest.mock('../../src/config', () => ({
    faceit_webhook_secret: 'test-secret',
}));

jest.mock('../../src/services/subscriptionService');

const { handleMatchEvent, handleMatchFinishedEvent } =
    require('../../src/services/subscriptionService');
const { handleFaceitWebhook } = require('../../src/handlers/faceitWebhookHandler');

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const mockRes = () => {
    const res = {};
    res.sendStatus = jest.fn().mockReturnValue(res);
    return res;
};

const makeReq = ({ secret = 'test-secret', body = {} } = {}) => ({
    headers: { 'x-faceit-webhook-secret': secret },
    body,
});

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Secret validation
// ---------------------------------------------------------------------------

describe('secret validation', () => {
    it('returns 401 when the secret header is missing', async () => {
        const req = { headers: {}, body: {} };
        const res = mockRes();
        await handleFaceitWebhook(req, res);
        expect(res.sendStatus).toHaveBeenCalledWith(401);
    });

    it('returns 401 when the secret header is wrong', async () => {
        const res = mockRes();
        await handleFaceitWebhook(makeReq({ secret: 'wrong-secret' }), res);
        expect(res.sendStatus).toHaveBeenCalledWith(401);
    });

    it('proceeds when the secret matches', async () => {
        handleMatchEvent.mockResolvedValue();
        const res = mockRes();
        await handleFaceitWebhook(makeReq({
            body: { event: 'match_status_ready', payload: {} },
        }), res);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
    });
});

// ---------------------------------------------------------------------------
// Unsupported / missing events
// ---------------------------------------------------------------------------

describe('unsupported events', () => {
    it('returns 200 without processing for an unknown event type', async () => {
        const res = mockRes();
        await handleFaceitWebhook(makeReq({ body: { event: 'player_status_updated', payload: {} } }), res);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(handleMatchEvent).not.toHaveBeenCalled();
        expect(handleMatchFinishedEvent).not.toHaveBeenCalled();
    });

    it('returns 200 without processing when event field is missing', async () => {
        const res = mockRes();
        await handleFaceitWebhook(makeReq({ body: { payload: {} } }), res);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(handleMatchEvent).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// match_status_ready
// ---------------------------------------------------------------------------

describe('match_status_ready', () => {
    it('responds 200 immediately and invokes handleMatchEvent with the payload', async () => {
        handleMatchEvent.mockResolvedValue();
        const payload = { id: 'match-123', teams: {} };

        const res = mockRes();
        await handleFaceitWebhook(makeReq({ body: { event: 'match_status_ready', payload } }), res);

        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(handleMatchEvent).toHaveBeenCalledWith(payload);
        expect(handleMatchFinishedEvent).not.toHaveBeenCalled();
    });

    it('does not propagate errors from handleMatchEvent (fire-and-forget)', async () => {
        handleMatchEvent.mockRejectedValue(new Error('Subscription service down'));

        const res = mockRes();
        await expect(
            handleFaceitWebhook(makeReq({ body: { event: 'match_status_ready', payload: {} } }), res)
        ).resolves.not.toThrow();

        expect(res.sendStatus).toHaveBeenCalledWith(200);
    });
});

// ---------------------------------------------------------------------------
// match_status_finished
// ---------------------------------------------------------------------------

describe('match_status_finished', () => {
    it('responds 200 immediately and invokes handleMatchFinishedEvent with the payload', async () => {
        handleMatchFinishedEvent.mockResolvedValue();
        const payload = { id: 'match-456', results: {} };

        const res = mockRes();
        await handleFaceitWebhook(makeReq({ body: { event: 'match_status_finished', payload } }), res);

        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(handleMatchFinishedEvent).toHaveBeenCalledWith(payload);
        expect(handleMatchEvent).not.toHaveBeenCalled();
    });

    it('does not propagate errors from handleMatchFinishedEvent', async () => {
        handleMatchFinishedEvent.mockRejectedValue(new Error('Timeout'));

        const res = mockRes();
        await expect(
            handleFaceitWebhook(makeReq({ body: { event: 'match_status_finished', payload: {} } }), res)
        ).resolves.not.toThrow();

        expect(res.sendStatus).toHaveBeenCalledWith(200);
    });
});
