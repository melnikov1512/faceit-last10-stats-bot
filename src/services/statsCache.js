'use strict';

/**
 * In-memory TTL cache for /stats PNG buffers.
 *
 * Key format: `${chatId}:${matchesCount}`
 * Default TTL: 5 minutes.
 *
 * Designed for GCF warm-instance optimisation: eliminates redundant FACEIT API
 * calls when the same chat requests /stats with the same matchesCount within
 * the TTL window. Does NOT coordinate across multiple GCF instances.
 *
 * Usage:
 *   const cached = getCached(`${chatId}:${matchesCount}`);
 *   if (cached) { ... return; }
 *   // ... heavy work ...
 *   setCached(`${chatId}:${matchesCount}`, imageBuffer);
 *
 *   // On player list change:
 *   invalidate(`${chatId}:`);
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** @type {Map<string, { data: Buffer, expiresAt: number }>} */
const _cache = new Map();

/**
 * Retrieve cached data for key.
 * Returns the stored Buffer if the entry exists and has not yet expired;
 * otherwise deletes the stale entry and returns null.
 *
 * @param {string} key
 * @returns {Buffer|null}
 */
function getCached(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
        _cache.delete(key);
        return null;
    }
    return entry.data;
}

/**
 * Store data in the cache under key with an optional TTL.
 *
 * @param {string} key
 * @param {Buffer} data
 * @param {number} [ttlMs=DEFAULT_TTL_MS]
 */
function setCached(key, data, ttlMs = DEFAULT_TTL_MS) {
    _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Remove all cache entries whose key starts with `prefix`.
 * Use `${chatId}:` to invalidate all matchesCount variants for a given chat.
 *
 * @param {string} prefix  e.g. `"123:"`
 */
function invalidate(prefix) {
    for (const key of _cache.keys()) {
        if (key.startsWith(prefix)) {
            _cache.delete(key);
        }
    }
}

/**
 * Clear the entire cache.
 * Exposed for unit tests only — do NOT call in production code.
 */
function _reset() {
    _cache.clear();
}

module.exports = { getCached, setCached, invalidate, _reset };
