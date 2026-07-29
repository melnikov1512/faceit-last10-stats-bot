'use strict';

// ---------------------------------------------------------------------------
// Mock axios and form-data BEFORE requiring the module under test
// ---------------------------------------------------------------------------

jest.mock('axios');
const axios = require('axios');

const mockAppend = jest.fn();
const mockGetHeaders = jest.fn(() => ({ 'content-type': 'multipart/form-data' }));

jest.mock('form-data', () => {
    return jest.fn().mockImplementation(() => ({
        append: mockAppend,
        getHeaders: mockGetHeaders,
    }));
});

jest.mock('../../src/config', () => ({ telegram_bot_token: 'test-token' }));

const { sendPhoto } = require('../../src/services/telegramService');

beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: { result: { message_id: 999 } } });
});

// ---------------------------------------------------------------------------
// sendPhoto — reply_parameters handling
// ---------------------------------------------------------------------------

describe('sendPhoto', () => {
    it('appends reply_parameters with message_id and allow_sending_without_reply when replyToMessageId is passed', async () => {
        await sendPhoto('chat-1', Buffer.from('img'), 'caption', null, 42);

        expect(mockAppend).toHaveBeenCalledWith(
            'reply_parameters',
            JSON.stringify({ message_id: 42, allow_sending_without_reply: true })
        );
    });

    it('does not append reply_parameters when replyToMessageId is omitted', async () => {
        await sendPhoto('chat-1', Buffer.from('img'), 'caption');

        const replyParamsCalls = mockAppend.mock.calls.filter(([field]) => field === 'reply_parameters');
        expect(replyParamsCalls).toHaveLength(0);
    });

    it('does not append reply_parameters when replyToMessageId is explicitly null', async () => {
        await sendPhoto('chat-1', Buffer.from('img'), 'caption', null, null);

        const replyParamsCalls = mockAppend.mock.calls.filter(([field]) => field === 'reply_parameters');
        expect(replyParamsCalls).toHaveLength(0);
    });
});
