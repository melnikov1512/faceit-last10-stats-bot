'use strict';

const { isRateLimited, _reset } = require('../../src/utils/rateLimiter');

beforeEach(() => {
    _reset(); // clear state between tests
});

describe('isRateLimited', () => {
    it('returns false on the first call (not yet limited)', () => {
        expect(isRateLimited('chat1:stats', 5000)).toBe(false);
    });

    it('returns true on a second call within the cool-down window', () => {
        isRateLimited('chat1:stats', 5000); // first call records it
        expect(isRateLimited('chat1:stats', 5000)).toBe(true);
    });

    it('returns false again after the cool-down period has elapsed', () => {
        // Use 0 ms limit so it expires immediately
        isRateLimited('chat1:stats', 0);
        // Even with 0 ms, Date.now() >= expiresAt, so next call should pass
        expect(isRateLimited('chat1:stats', 0)).toBe(false);
    });

    it('treats different keys as independent', () => {
        isRateLimited('chat1:stats',   5000); // limit chat1
        expect(isRateLimited('chat2:stats',   5000)).toBe(false); // chat2 is free
        expect(isRateLimited('chat1:players', 5000)).toBe(false); // different command
    });

    it('does not affect a different chatId with the same command', () => {
        isRateLimited('111:stats', 30_000);
        isRateLimited('222:stats', 30_000);
        expect(isRateLimited('333:stats', 30_000)).toBe(false);
    });

    it('resets properly between test runs via _reset()', () => {
        isRateLimited('chat1:stats', 60_000); // 60 s limit
        _reset();
        expect(isRateLimited('chat1:stats', 60_000)).toBe(false); // cleared
    });
});
