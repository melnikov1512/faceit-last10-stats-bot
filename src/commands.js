/**
 * Central registry of all bot commands.
 *
 * To add a new command:
 *   1. Add one entry to COMMAND_LIST below.
 *   2. Add a handler in src/handlers/commandHandler.js.
 *   That's it — the Telegram menu, /help text, and routing allowlist
 *   are all derived automatically from this list.
 */

const COMMAND_LIST = [
    {
        key:         'STATS',
        command:     '/stats',
        args:        '[N]',
        description: 'Статистика за последние N матчей (по умолч. 10, диапазон 2–100)',
    },
    {
        key:         'ADD_PLAYER',
        command:     '/add_player',
        args:        '&lt;nickname&gt;',
        description: 'Добавить игрока в список отслеживания',
        prompt:      'Введите никнейм игрока для добавления:',
        placeholder: 'nickname',
    },
    {
        key:         'REMOVE_PLAYER',
        command:     '/remove_player',
        args:        '&lt;nickname&gt;',
        description: 'Удалить игрока из списка отслеживания',
        prompt:      'Введите никнейм игрока для удаления:',
        placeholder: 'nickname',
    },
    {
        key:         'PLAYERS',
        command:     '/players',
        args:        null,
        description: 'Показать список отслеживаемых игроков',
    },
    {
        key:         'SUBSCRIBE',
        command:     '/subscribe',
        args:        '&lt;nickname&gt;',
        description: 'Подписаться на уведомления о начале матчей игрока',
        prompt:      'Введите никнейм игрока для подписки:',
        placeholder: 'nickname',
    },
    {
        key:         'UNSUBSCRIBE',
        command:     '/unsubscribe',
        args:        '&lt;nickname&gt;',
        description: 'Отписаться от уведомлений о матчах игрока',
        prompt:      'Введите никнейм игрока для отписки:',
        placeholder: 'nickname',
    },
    {
        key:         'MY_SUBSCRIPTIONS',
        command:     '/my_subscriptions',
        args:        null,
        description: 'Показать активные подписки в этом чате',
    },
    {
        key:         'LIVE',
        command:     '/live',
        args:        null,
        description: 'Открыть активные матчи подписанных игроков',
    },
    {
        key:         'HELP',
        command:     '/help',
        args:        null,
        description: 'Показать справку по командам',
    },
];

/** { STATS: '/stats', ADD_PLAYER: '/add_player', ... } */
const COMMANDS = Object.fromEntries(COMMAND_LIST.map(c => [c.key, c.command]));

/** Ready-to-use payload for Telegram setMyCommands API */
const BOT_COMMANDS = COMMAND_LIST.map(c => ({
    command:     c.command.slice(1), // strip leading "/"
    description: c.description,
}));

module.exports = { COMMAND_LIST, COMMANDS, BOT_COMMANDS };
