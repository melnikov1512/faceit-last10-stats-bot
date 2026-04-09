'use strict';

jest.mock('../../src/services/faceitService');
jest.mock('../../src/services/storageService');
jest.mock('../../src/services/imageService');
jest.mock('../../src/services/telegramService');
jest.mock('../../src/services/matchService');
jest.mock('../../src/services/statsCache', () => ({
    getCached:  jest.fn(() => null), // cache miss by default
    setCached:  jest.fn(),
    invalidate: jest.fn(),
}));
jest.mock('../../src/utils/rateLimiter', () => ({
    isRateLimited: jest.fn(() => false), // not limited by default
}));
jest.mock('../../src/config', () => ({
    faceit_api_key: 'test-api-key',
    last_matches:   10,
    webapp_url:     'https://example.com/app',
    bot_username:   'testbot',
}));

const storageService = require('../../src/services/storageService');
const faceitService  = require('../../src/services/faceitService');
const imageService   = require('../../src/services/imageService');
const telegramService = require('../../src/services/telegramService');
const matchService   = require('../../src/services/matchService');
const statsCache     = require('../../src/services/statsCache');
const config         = require('../../src/config');
const rateLimiter    = require('../../src/utils/rateLimiter');

const { handleCommand } = require('../../src/handlers/commandHandler');
const { COMMANDS }      = require('../../src/commands');

const FAKE_IMAGE = Buffer.from('fake-png');

beforeEach(() => {
    jest.clearAllMocks();
    imageService.generateStatsImage.mockResolvedValue(FAKE_IMAGE);
    imageService.generatePlayerCard.mockResolvedValue(FAKE_IMAGE);
    imageService.generatePlayersListImage.mockResolvedValue(FAKE_IMAGE);
    telegramService.sendPhoto.mockResolvedValue();
    // default: empty player list (used by /add_player limit check)
    storageService.getPlayers.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------

describe('/help', () => {
    it('returns help text listing all commands', async () => {
        const result = await handleCommand(COMMANDS.HELP, 123, [], 'key');
        expect(typeof result).toBe('string');
        expect(result).toContain('/stats');
        expect(result).toContain('/mystats');
        expect(result).toContain('/add_player');
        expect(result).toContain('/remove_player');
        expect(result).toContain('/players');
        expect(result).toContain('/live');
        expect(result).toContain('/help');
    });
});

// ---------------------------------------------------------------------------
// /mystats
// ---------------------------------------------------------------------------

describe('/mystats', () => {
    it('returns force_reply when no arguments are provided', async () => {
        const result = await handleCommand(COMMANDS.MYSTATS, 123, [], 'key');
        expect(result.type).toBe('force_reply');
        expect(result.placeholder).toBe('nickname');
    });

    it('returns rate-limit message when called too frequently', async () => {
        rateLimiter.isRateLimited.mockReturnValueOnce(true);
        const result = await handleCommand(COMMANDS.MYSTATS, 123, ['s1mple'], 'key');
        expect(result).toContain('⏳');
        expect(faceitService.getPlayerDetailsByNickname).not.toHaveBeenCalled();
    });

    it('returns an error when the player is not found on FACEIT', async () => {
        faceitService.getPlayerDetailsByNickname.mockResolvedValue(null);

        const result = await handleCommand(COMMANDS.MYSTATS, 123, ['unknown_nick'], 'key');
        expect(result).toContain('not found on FACEIT');
        expect(result).toContain('unknown_nick');
    });

    it('sends a stats photo and returns null for a found player', async () => {
        faceitService.getPlayerDetailsByNickname.mockResolvedValue({
            playerId: 'p1', nickname: 's1mple', elo: 3000, skillLevel: 10,
        });
        faceitService.getLeaderboardStats.mockResolvedValue([{ nickname: 's1mple', adr: 90 }]);

        const result = await handleCommand(COMMANDS.MYSTATS, 123, ['s1mple'], 'key');

        expect(faceitService.getLeaderboardStats).toHaveBeenCalledWith(
            'key', [{ id: 'p1', nickname: 's1mple' }], 10
        );
        expect(telegramService.sendPhoto).toHaveBeenCalledWith(123, FAKE_IMAGE);
        expect(result).toBeNull();
    });

    it('uses custom match count from second argument', async () => {
        faceitService.getPlayerDetailsByNickname.mockResolvedValue({
            playerId: 'p1', nickname: 's1mple',
        });
        faceitService.getLeaderboardStats.mockResolvedValue([{ nickname: 's1mple', adr: 90 }]);

        await handleCommand(COMMANDS.MYSTATS, 123, ['s1mple', '25'], 'key');

        expect(faceitService.getLeaderboardStats).toHaveBeenCalledWith(
            'key', expect.any(Array), 25
        );
    });

    it('uses default count when N argument is out of range', async () => {
        faceitService.getPlayerDetailsByNickname.mockResolvedValue({
            playerId: 'p1', nickname: 's1mple',
        });
        faceitService.getLeaderboardStats.mockResolvedValue([{ nickname: 's1mple', adr: 90 }]);

        await handleCommand(COMMANDS.MYSTATS, 123, ['s1mple', '200'], 'key');

        expect(faceitService.getLeaderboardStats).toHaveBeenCalledWith(
            'key', expect.any(Array), 10
        );
    });

    it('returns error message when leaderboard comes back empty', async () => {
        faceitService.getPlayerDetailsByNickname.mockResolvedValue({
            playerId: 'p1', nickname: 's1mple',
        });
        faceitService.getLeaderboardStats.mockResolvedValue([]);

        const result = await handleCommand(COMMANDS.MYSTATS, 123, ['s1mple'], 'key');
        expect(result).toContain('Не удалось загрузить');
    });
});

// ---------------------------------------------------------------------------
// /stats
// ---------------------------------------------------------------------------

describe('/stats', () => {
    it('returns rate-limit message when called too frequently', async () => {
        rateLimiter.isRateLimited.mockReturnValueOnce(true);
        const result = await handleCommand(COMMANDS.STATS, 123, [], 'key');
        expect(result).toContain('⏳');
        expect(storageService.getPlayers).not.toHaveBeenCalled();
    });

    it('returns "no players" message when the chat has no tracked players', async () => {
        storageService.getPlayers.mockResolvedValue([]);
        const result = await handleCommand(COMMANDS.STATS, 123, [], 'key');
        expect(result).toContain('No players tracked');
    });

    it('sends a photo and returns null when players and stats exist', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 's1mple' }]);
        faceitService.getLeaderboardStats.mockResolvedValue([{ nickname: 's1mple', adr: 80 }]);

        const result = await handleCommand(COMMANDS.STATS, 123, [], 'key');

        expect(telegramService.sendPhoto).toHaveBeenCalledWith(123, FAKE_IMAGE);
        expect(result).toBeNull();
    });

    it('passes the custom match count argument to the stats service', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 's1mple' }]);
        faceitService.getLeaderboardStats.mockResolvedValue([{ nickname: 's1mple', adr: 80 }]);

        await handleCommand(COMMANDS.STATS, 123, ['20'], 'key');

        expect(faceitService.getLeaderboardStats).toHaveBeenCalledWith(
            'key', expect.any(Array), 20
        );
    });

    it('uses default count when argument is above 100', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 'p' }]);
        faceitService.getLeaderboardStats.mockResolvedValue([{ nickname: 'p', adr: 50 }]);

        await handleCommand(COMMANDS.STATS, 123, ['200'], 'key');

        expect(faceitService.getLeaderboardStats).toHaveBeenCalledWith(
            'key', expect.any(Array), 10
        );
    });

    it('uses default count when argument is below 2', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 'p' }]);
        faceitService.getLeaderboardStats.mockResolvedValue([{ nickname: 'p', adr: 50 }]);

        await handleCommand(COMMANDS.STATS, 123, ['1'], 'key');

        expect(faceitService.getLeaderboardStats).toHaveBeenCalledWith(
            'key', expect.any(Array), 10
        );
    });

    it('returns an error message when the leaderboard is empty', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 'p' }]);
        faceitService.getLeaderboardStats.mockResolvedValue([]);

        const result = await handleCommand(COMMANDS.STATS, 123, [], 'key');
        expect(result).toContain('Failed to retrieve');
    });

    it('serves from cache and skips getLeaderboardStats on a cache hit', async () => {
        const cachedBuf = Buffer.from('cached-png');
        statsCache.getCached.mockReturnValueOnce(cachedBuf);

        const result = await handleCommand(COMMANDS.STATS, 123, [], 'key');

        expect(faceitService.getLeaderboardStats).not.toHaveBeenCalled();
        expect(telegramService.sendPhoto).toHaveBeenCalledWith(123, cachedBuf);
        expect(result).toBeNull();
    });

    it('stores the generated image in the cache on a cache miss', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 's1mple' }]);
        faceitService.getLeaderboardStats.mockResolvedValue([{ nickname: 's1mple', adr: 80 }]);

        await handleCommand(COMMANDS.STATS, 123, [], 'key');

        expect(statsCache.setCached).toHaveBeenCalledWith('123:10', FAKE_IMAGE);
    });

    it('uses the matchesCount in the cache key', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 's1mple' }]);
        faceitService.getLeaderboardStats.mockResolvedValue([{ nickname: 's1mple', adr: 80 }]);

        await handleCommand(COMMANDS.STATS, 123, ['25'], 'key');

        expect(statsCache.setCached).toHaveBeenCalledWith('123:25', FAKE_IMAGE);
    });
});

// ---------------------------------------------------------------------------
// /add_player
// ---------------------------------------------------------------------------

describe('/add_player', () => {
    it('returns force_reply when no arguments are provided', async () => {
        const result = await handleCommand(COMMANDS.ADD_PLAYER, 123, [], 'key');
        expect(result.type).toBe('force_reply');
        expect(result.placeholder).toBe('nickname');
    });

    it('returns an error when the player limit is reached', async () => {
        const fullList = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, nickname: `player${i}` }));
        storageService.getPlayers.mockResolvedValue(fullList);

        const result = await handleCommand(COMMANDS.ADD_PLAYER, 123, ['newplayer'], 'key');

        expect(result).toContain('лимит');
        expect(result).toContain('20');
        expect(faceitService.getPlayerDetailsByNickname).not.toHaveBeenCalled();
    });

    it('returns an error when the player is not found on FACEIT', async () => {
        faceitService.getPlayerDetailsByNickname.mockResolvedValue(null);

        const result = await handleCommand(COMMANDS.ADD_PLAYER, 123, ['unknown_nick'], 'key');
        expect(result).toContain('not found on FACEIT');
        expect(result).toContain('unknown_nick');
    });

    it('adds the player and sends a photo on success', async () => {
        faceitService.getPlayerDetailsByNickname.mockResolvedValue({
            playerId: 'p1', nickname: 's1mple', elo: 3000, skillLevel: 10, avatar: null,
        });
        storageService.addPlayer.mockResolvedValue();
        storageService.subscribeChat.mockResolvedValue();

        const result = await handleCommand(COMMANDS.ADD_PLAYER, 123, ['s1mple'], 'key', 'MyChat');

        expect(storageService.addPlayer).toHaveBeenCalledWith(
            123, { id: 'p1', nickname: 's1mple' }, 'MyChat'
        );
        expect(storageService.subscribeChat).toHaveBeenCalledWith(123, 'p1', 's1mple');
        expect(imageService.generatePlayerCard).toHaveBeenCalledWith(
            expect.objectContaining({ nickname: 's1mple' }), 'added'
        );
        expect(telegramService.sendPhoto).toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('invalidates stats cache for the chat after adding a player', async () => {
        faceitService.getPlayerDetailsByNickname.mockResolvedValue({
            playerId: 'p1', nickname: 's1mple', elo: 3000, skillLevel: 10, avatar: null,
        });
        storageService.addPlayer.mockResolvedValue();
        storageService.subscribeChat.mockResolvedValue();

        await handleCommand(COMMANDS.ADD_PLAYER, 123, ['s1mple'], 'key', 'MyChat');

        expect(statsCache.invalidate).toHaveBeenCalledWith('123:');
    });
});

// ---------------------------------------------------------------------------
// /remove_player
// ---------------------------------------------------------------------------

describe('/remove_player', () => {
    it('returns force_reply when no arguments are provided', async () => {
        const result = await handleCommand(COMMANDS.REMOVE_PLAYER, 123, [], 'key');
        expect(result.type).toBe('force_reply');
    });

    it('returns an error when the player is not in the tracking list', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 'existing' }]);

        const result = await handleCommand(COMMANDS.REMOVE_PLAYER, 123, ['nonexistent'], 'key');
        expect(result).toContain('is not in the tracking list');
        expect(result).toContain('nonexistent');
    });

    it('removes the player, unsubscribes, and sends a photo', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 's1mple' }]);
        storageService.removePlayer.mockResolvedValue();
        storageService.unsubscribeChat.mockResolvedValue();
        faceitService.getPlayerDetails.mockResolvedValue({
            playerId: 'p1', nickname: 's1mple', elo: 3000,
        });

        const result = await handleCommand(COMMANDS.REMOVE_PLAYER, 123, ['s1mple'], 'key');

        expect(storageService.removePlayer).toHaveBeenCalledWith(123, 'p1');
        expect(storageService.unsubscribeChat).toHaveBeenCalledWith(123, 'p1');
        expect(telegramService.sendPhoto).toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('matches nicknames case-insensitively', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 'S1mple' }]);
        storageService.removePlayer.mockResolvedValue();
        storageService.unsubscribeChat.mockResolvedValue();
        faceitService.getPlayerDetails.mockResolvedValue({ playerId: 'p1', nickname: 'S1mple' });

        const result = await handleCommand(COMMANDS.REMOVE_PLAYER, 123, ['s1MPLE'], 'key');

        expect(storageService.removePlayer).toHaveBeenCalledWith(123, 'p1');
        expect(result).toBeNull();
    });

    it('invalidates stats cache for the chat after removing a player', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 's1mple' }]);
        storageService.removePlayer.mockResolvedValue();
        storageService.unsubscribeChat.mockResolvedValue();
        faceitService.getPlayerDetails.mockResolvedValue({ playerId: 'p1', nickname: 's1mple', elo: 3000 });

        await handleCommand(COMMANDS.REMOVE_PLAYER, 123, ['s1mple'], 'key');

        expect(statsCache.invalidate).toHaveBeenCalledWith('123:');
    });
});

// ---------------------------------------------------------------------------
// /players
// ---------------------------------------------------------------------------

describe('/players', () => {
    it('returns rate-limit message when called too frequently', async () => {
        rateLimiter.isRateLimited.mockReturnValueOnce(true);
        const result = await handleCommand(COMMANDS.PLAYERS, 123, [], 'key');
        expect(result).toContain('⏳');
        expect(storageService.getPlayers).not.toHaveBeenCalled();
    });

    it('returns "no players" message when the chat has no tracked players', async () => {
        storageService.getPlayers.mockResolvedValue([]);
        const result = await handleCommand(COMMANDS.PLAYERS, 123, [], 'key');
        expect(result).toContain('No players tracked');
    });

    it('sends a players-list image and returns null', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 's1mple' }]);
        faceitService.getPlayerDetails.mockResolvedValue({
            playerId: 'p1', nickname: 's1mple', elo: 3000, skillLevel: 10, avatar: null,
        });

        const result = await handleCommand(COMMANDS.PLAYERS, 123, [], 'key');

        expect(imageService.generatePlayersListImage).toHaveBeenCalled();
        expect(telegramService.sendPhoto).toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it('gracefully falls back when getPlayerDetails rejects', async () => {
        storageService.getPlayers.mockResolvedValue([{ id: 'p1', nickname: 'err_player' }]);
        faceitService.getPlayerDetails.mockRejectedValue(new Error('API down'));

        // Should not throw — error is caught inside handlePlayers
        await expect(handleCommand(COMMANDS.PLAYERS, 123, [], 'key')).resolves.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// /live
// ---------------------------------------------------------------------------

describe('/live', () => {
    it('returns an error when WEBAPP_URL is not configured', async () => {
        const savedUrl = config.webapp_url;
        config.webapp_url = null;

        storageService.getChatSubscriptions.mockResolvedValue([]);
        const result = await handleCommand(COMMANDS.LIVE, 123, [], 'key');

        config.webapp_url = savedUrl; // restore
        expect(result).toContain('WEBAPP_URL');
    });

    it('returns a web_app result when WEBAPP_URL is set', async () => {
        storageService.getChatSubscriptions.mockResolvedValue([]);

        const result = await handleCommand(COMMANDS.LIVE, 123, [], 'key');

        expect(result.type).toBe('web_app');
        expect(result.url).toContain('chatId=123');
    });

    it('includes match list in text when active matches exist', async () => {
        storageService.getChatSubscriptions.mockResolvedValue([{ playerId: 'p1' }]);
        matchService.collectMatchIds.mockResolvedValue(['m1']);
        matchService.fetchActiveMatchDetails.mockResolvedValue([{
            matchId: 'm1',
            match: {
                status: 'ONGOING',
                teams: { faction1: { name: 'Team A' }, faction2: { name: 'Team B' } },
            },
        }]);

        const result = await handleCommand(COMMANDS.LIVE, 123, [], 'key');

        expect(result.type).toBe('web_app');
        expect(result.text).toContain('Team A');
        expect(result.text).toContain('Team B');
    });

    it('shows "no active matches" when match list is empty', async () => {
        storageService.getChatSubscriptions.mockResolvedValue([{ playerId: 'p1' }]);
        matchService.collectMatchIds.mockResolvedValue([]);

        const result = await handleCommand(COMMANDS.LIVE, 123, [], 'key');
        expect(result.text).toContain('Нет активных матчей');
    });
});

// ---------------------------------------------------------------------------
// Unknown command
// ---------------------------------------------------------------------------

describe('unknown command', () => {
    it('returns null for an unrecognised command string', async () => {
        const result = await handleCommand('/i_do_not_exist', 123, [], 'key');
        expect(result).toBeNull();
    });
});
