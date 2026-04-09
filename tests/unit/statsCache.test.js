'use strict';

const { getCached, setCached, invalidate, _reset } = require('../../src/services/statsCache');

const FAKE_BUF = Buffer.from('fake-png');

beforeEach(() => {
    _reset();
});

describe('getCached', () => {
    it('returns null on a cold cache (miss)', () => {
        expect(getCached('123:10')).toBeNull();
    });

    it('returns the stored buffer after setCached (hit)', () => {
        setCached('123:10', FAKE_BUF);
        const result = getCached('123:10');
        expect(result).toBe(FAKE_BUF);
    });

    it('returns null after TTL has expired', () => {
        setCached('123:10', FAKE_BUF, 0); // 0 ms → expires immediately
        expect(getCached('123:10')).toBeNull();
    });

    it('removes the stale entry from the internal map when TTL expires', () => {
        setCached('123:10', FAKE_BUF, 0);
        getCached('123:10'); // triggers deletion
        // A second call should also return null (not resurrect the entry)
        expect(getCached('123:10')).toBeNull();
    });

    it('different keys do not interfere with each other', () => {
        const buf20 = Buffer.from('20-matches');
        setCached('123:10', FAKE_BUF);
        setCached('123:20', buf20);

        expect(getCached('123:10')).toBe(FAKE_BUF);
        expect(getCached('123:20')).toBe(buf20);
        expect(getCached('456:10')).toBeNull();
    });

    it('returns null for a key that was never set', () => {
        setCached('123:10', FAKE_BUF);
        expect(getCached('999:10')).toBeNull();
    });
});

describe('setCached', () => {
    it('overwrites an existing entry for the same key', () => {
        const first  = Buffer.from('first');
        const second = Buffer.from('second');
        setCached('123:10', first);
        setCached('123:10', second);
        expect(getCached('123:10')).toBe(second);
    });

    it('uses DEFAULT_TTL_MS (~5 min) when ttlMs is omitted', () => {
        setCached('123:10', FAKE_BUF);
        // Should still be available immediately
        expect(getCached('123:10')).toBe(FAKE_BUF);
    });

    it('respects a custom TTL', () => {
        setCached('123:10', FAKE_BUF, 9999);
        expect(getCached('123:10')).toBe(FAKE_BUF);
    });
});

describe('invalidate', () => {
    it('removes an exact key matching the prefix', () => {
        setCached('123:10', FAKE_BUF);
        invalidate('123:');
        expect(getCached('123:10')).toBeNull();
    });

    it('removes all matchesCount variants for the given chatId', () => {
        setCached('123:10', FAKE_BUF);
        setCached('123:20', Buffer.from('20'));
        setCached('123:50', Buffer.from('50'));
        invalidate('123:');
        expect(getCached('123:10')).toBeNull();
        expect(getCached('123:20')).toBeNull();
        expect(getCached('123:50')).toBeNull();
    });

    it('does not remove entries belonging to a different chatId', () => {
        setCached('123:10', FAKE_BUF);
        setCached('456:10', Buffer.from('other'));
        invalidate('123:');
        expect(getCached('456:10')).not.toBeNull();
    });

    it('is a no-op when no matching keys exist', () => {
        // Should not throw
        expect(() => invalidate('999:')).not.toThrow();
    });
});

describe('_reset', () => {
    it('clears all entries', () => {
        setCached('123:10', FAKE_BUF);
        setCached('456:20', Buffer.from('other'));
        _reset();
        expect(getCached('123:10')).toBeNull();
        expect(getCached('456:20')).toBeNull();
    });
});
