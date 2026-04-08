'use strict';

jest.mock('../../src/handlers/commandHandler');
jest.mock('../../src/config', () => ({
    faceit_api_key: 'test-api-key',
    bot_username:   'testbot',
    webapp_url:     null,
}));

const { handleCommand } = require('../../src/handlers/commandHandler');
const { handleWebhook } = require('../../src/handlers/webhookHandler');
const { COMMAND_LIST }  = require('../../src/commands');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockRes = () => {
    const res = {};
    res.status    = jest.fn().mockReturnValue(res);
    res.json      = jest.fn().mockReturnValue(res);
    res.sendStatus = jest.fn().mockReturnValue(res);
    return res;
};

const makeReq = (message = {}) => ({
    body: {
        message: {
            chat: { id: 123, type: 'private' },
            text: '/help',
            ...message,
        },
    },
});

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Ignored / invalid updates
// ---------------------------------------------------------------------------

describe('ignoring invalid updates', () => {
    it('returns 200 when body has no message', async () => {
        const res = mockRes();
        await handleWebhook({ body: {} }, res);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
    });

    it('returns 200 when message has no text', async () => {
        const res = mockRes();
        await handleWebhook({ body: { message: { chat: { id: 123 } } } }, res);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
    });

    it('returns 200 when message has no chat ID', async () => {
        const res = mockRes();
        await handleWebhook({ body: { message: { text: '/help' } } }, res);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
    });

    it('returns 200 for an unknown command', async () => {
        const res = mockRes();
        await handleWebhook(makeReq({ text: '/unknown_command_xyz' }), res);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(handleCommand).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Missing API key
// ---------------------------------------------------------------------------

describe('missing API key', () => {
    it('returns an API key error message when faceit_api_key is falsy', async () => {
        const config = require('../../src/config');
        const saved  = config.faceit_api_key;
        config.faceit_api_key = null;

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/help', chat: { id: 123, type: 'private' } }), res);

        config.faceit_api_key = saved;
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            text: expect.stringContaining('API Key'),
        }));
    });
});

// ---------------------------------------------------------------------------
// Normal command routing
// ---------------------------------------------------------------------------

describe('normal command routing', () => {
    it('routes /help and sends the result as HTML message', async () => {
        handleCommand.mockResolvedValue('<b>Help text</b>');

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/help', chat: { id: 123, type: 'private' } }), res);

        expect(handleCommand).toHaveBeenCalledWith('/help', 123, [], 'test-api-key', null);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            method:     'sendMessage',
            chat_id:    123,
            text:       '<b>Help text</b>',
            parse_mode: 'HTML',
        }));
    });

    it('strips @botname suffix from command', async () => {
        handleCommand.mockResolvedValue('ok');

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/help@MyFaceitBot', chat: { id: 123, type: 'private' } }), res);

        expect(handleCommand).toHaveBeenCalledWith('/help', 123, [], 'test-api-key', null);
    });

    it('passes command arguments correctly', async () => {
        handleCommand.mockResolvedValue('ok');

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/stats 20', chat: { id: 123, type: 'private' } }), res);

        expect(handleCommand).toHaveBeenCalledWith('/stats', 123, ['20'], 'test-api-key', null);
    });

    it('sends 200 when handler returns null (photo already sent)', async () => {
        handleCommand.mockResolvedValue(null);

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/stats', chat: { id: 123, type: 'private' } }), res);

        expect(res.sendStatus).toHaveBeenCalledWith(200);
    });

    it('returns error message on unexpected handler exception', async () => {
        handleCommand.mockRejectedValue(new Error('Something broke'));

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/help', chat: { id: 123, type: 'private' } }), res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            text: expect.stringContaining('⚠️'),
        }));
    });
});

// ---------------------------------------------------------------------------
// force_reply
// ---------------------------------------------------------------------------

describe('force_reply result type', () => {
    const forceReplyResult = { type: 'force_reply', prompt: 'Enter nickname:', placeholder: 'nickname' };

    it('sends force_reply markup in a private chat', async () => {
        handleCommand.mockResolvedValue(forceReplyResult);

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/add_player', chat: { id: 123, type: 'private' } }), res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            reply_markup: { force_reply: true },
        }));
    });

    it('sends a usage hint in a group chat (no force_reply in groups)', async () => {
        handleCommand.mockResolvedValue(forceReplyResult);

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/add_player', chat: { id: -100456, type: 'group' } }), res);

        const payload = res.json.mock.calls[0][0];
        expect(payload.parse_mode).toBe('HTML');
        // In groups the handler sends plain text — no reply_markup at all
        expect(payload.reply_markup).toBeUndefined();
        // Should contain usage hint
        expect(payload.text).toContain('nickname');
    });
});

// ---------------------------------------------------------------------------
// web_app result type
// ---------------------------------------------------------------------------

describe('web_app result type', () => {
    const webAppResult = {
        type: 'web_app', text: 'Active matches', url: 'https://example.com/app?chatId=123', parse_mode: 'HTML',
    };

    it('sends a web_app inline button in a private chat', async () => {
        handleCommand.mockResolvedValue(webAppResult);

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/live', chat: { id: 123, type: 'private' } }), res);

        const button = res.json.mock.calls[0][0].reply_markup.inline_keyboard[0][0];
        expect(button).toHaveProperty('web_app');
    });

    it('sends a t.me url button in a group chat', async () => {
        handleCommand.mockResolvedValue(webAppResult);

        const res = mockRes();
        await handleWebhook(makeReq({ text: '/live', chat: { id: -100789, type: 'group' } }), res);

        const button = res.json.mock.calls[0][0].reply_markup.inline_keyboard[0][0];
        expect(button).toHaveProperty('url');
        expect(button).not.toHaveProperty('web_app');
    });

    it('falls back to the webapp url when bot_username is not set', async () => {
        const config = require('../../src/config');
        const savedUsername = config.bot_username;
        config.bot_username = null;

        handleCommand.mockResolvedValue(webAppResult);
        const res = mockRes();
        await handleWebhook(makeReq({ text: '/live', chat: { id: -100789, type: 'group' } }), res);

        config.bot_username = savedUsername;
        const button = res.json.mock.calls[0][0].reply_markup.inline_keyboard[0][0];
        expect(button.url).toBe(webAppResult.url);
    });
});

// ---------------------------------------------------------------------------
// ForceReply detection (reply to bot message)
// ---------------------------------------------------------------------------

describe('ForceReply detection', () => {
    it('routes a reply to the /add_player bot prompt as add_player command', async () => {
        const addPlayerCmd = COMMAND_LIST.find(c => c.key === 'ADD_PLAYER');
        handleCommand.mockResolvedValue(null);

        const req = {
            body: {
                message: {
                    chat: { id: 123, type: 'private' },
                    text: 's1mple',
                    reply_to_message: {
                        from: { is_bot: true },
                        text: addPlayerCmd.prompt,
                    },
                },
            },
        };
        const res = mockRes();
        await handleWebhook(req, res);

        expect(handleCommand).toHaveBeenCalledWith(
            '/add_player', 123, ['s1mple'], 'test-api-key', null
        );
    });

    it('routes a reply to the /remove_player bot prompt as remove_player command', async () => {
        const removePlayerCmd = COMMAND_LIST.find(c => c.key === 'REMOVE_PLAYER');
        handleCommand.mockResolvedValue(null);

        const req = {
            body: {
                message: {
                    chat: { id: 123, type: 'private' },
                    text: 'niko',
                    reply_to_message: {
                        from: { is_bot: true },
                        text: removePlayerCmd.prompt,
                    },
                },
            },
        };
        const res = mockRes();
        await handleWebhook(req, res);

        expect(handleCommand).toHaveBeenCalledWith(
            '/remove_player', 123, ['niko'], 'test-api-key', null
        );
    });

    it('ignores a reply to an unknown prompt (not a registered bot prompt)', async () => {
        const res = mockRes();
        const req = {
            body: {
                message: {
                    chat: { id: 123, type: 'private' },
                    text: 'some reply',
                    reply_to_message: {
                        from: { is_bot: true },
                        text: 'This prompt is not registered',
                    },
                },
            },
        };
        await handleWebhook(req, res);
        // Falls through to regular command parsing; "some reply" is not a command
        expect(res.sendStatus).toHaveBeenCalledWith(200);
    });
});
