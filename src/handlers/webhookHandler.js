const { handleCommand } = require('./commandHandler');
const config = require('../config');
const { COMMANDS, COMMAND_LIST } = require('../commands');

// Map ForceReply prompt texts → command for matching replies
const PROMPT_TO_COMMAND = Object.fromEntries(
    COMMAND_LIST.filter(c => c.prompt).map(c => [c.prompt, c])
);

async function handleWebhook(req, res) {
    const { body } = req;
    
    // Log incoming object for debugging in Google Cloud Logs
    console.log('Received update:', JSON.stringify(body));

    const { message } = body;
    const chatId = message?.chat?.id;
    const text = message?.text;

    // If no text or chat ID, return 200 to prevent Telegram from retrying
    if (!chatId || !text) {
        return res.sendStatus(200);
    }

    let command, args;

    // Detect reply to a bot ForceReply prompt
    const replyTo = message.reply_to_message;
    if (replyTo?.from?.is_bot && replyTo?.text) {
        console.log('[ForceReply] Reply to bot detected, replyTo.text:', JSON.stringify(replyTo.text));
        const matched = PROMPT_TO_COMMAND[replyTo.text];
        if (matched) {
            console.log('[ForceReply] Matched command:', matched.command);
            command = matched.command;
            args = [text.trim()];
        } else {
            console.log('[ForceReply] No matching prompt found. Known prompts:', Object.keys(PROMPT_TO_COMMAND));
        }
    }

    // Otherwise parse as a regular command
    if (!command) {
        const parts = text.trim().split(/\s+/);
        if (parts.length === 0) return res.sendStatus(200);

        const cmdRaw = parts[0];
        args = parts.slice(1);
        command = cmdRaw.split('@')[0];

        const allowedCommands = Object.values(COMMANDS);
        if (!allowedCommands.includes(command)) {
            return res.sendStatus(200);
        }
    }

    try {
        const apiKey = config.faceit_api_key;

        if (!apiKey) {
            console.error('FACEIT_API_KEY is missing');
            return res.json({
                method: 'sendMessage',
                chat_id: chatId,
                text: '⚠️ Bot configuration error (API Key).'
            });
        }

        const chatName = message.chat.title ||
            [message.chat.first_name, message.chat.last_name].filter(Boolean).join(' ') ||
            null;
        const chatType = message.chat.type;

        const result = await handleCommand(command, chatId, args, apiKey, chatName);

        // Handler sent the response directly (e.g. photo) — just acknowledge
        if (result === null) {
            return res.sendStatus(200);
        }

        // ForceReply: ask user to provide the missing argument
        if (result?.type === 'force_reply') {
            const isPrivate = message.chat.type === 'private';
            if (isPrivate) {
                // In private chats ForceReply works perfectly
                return res.json({
                    method: 'sendMessage',
                    chat_id: chatId,
                    text: result.prompt,
                    reply_markup: {
                        force_reply: true,
                    },
                });
            } else {
                // In groups bots don't receive plain-text replies (privacy mode),
                // so show a usage hint instead
                return res.json({
                    method: 'sendMessage',
                    chat_id: chatId,
                    text: `${result.prompt}\n\n<code>${command} ${result.placeholder}</code>`,
                    parse_mode: 'HTML',
                });
            }
        }

        // web_app inline button is restricted to private chats (Telegram returns BUTTON_TYPE_INVALID in groups).
        // In groups, use a t.me direct link which opens the Mini App inside Telegram.
        if (result?.type === 'web_app') {
            const isPrivate = message.chat.type === 'private';
            let button;
            if (isPrivate) {
                button = { text: '📊 Открыть', web_app: { url: result.url } };
            } else {
                // Direct link opens Mini App inside Telegram; chatId passed as start_param
                const username = config.bot_username;
                const directUrl = username
                    ? `https://t.me/${username}?startapp=${encodeURIComponent(chatId)}&mode=compact`
                    : result.url;
                button = { text: '📊 Открыть', url: directUrl };
            }
            return res.json({
                method: 'sendMessage',
                chat_id: chatId,
                text: result.text,
                parse_mode: result.parse_mode || undefined,
                reply_markup: { inline_keyboard: [[button]] },
            });
        }

        res.json({
            method: 'sendMessage',
            chat_id: chatId,
            text: result,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error(`Error processing ${command}:`, error);
        if (error.stack) {
             console.error(error.stack);
        }

        const replyPayload = {
            method: 'sendMessage',
            chat_id: chatId,
            text: `⚠️ Error processing request: ${error.message || 'Please try again later.'}`
        };
        res.json(replyPayload);
    }
}

module.exports = {
    handleWebhook
};