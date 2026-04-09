/**
 * Simple in-memory per-key rate limiter.
 *
 * Stores expiry timestamps in a Map keyed by an arbitrary string.
 * Designed for GCF warm-instance protection: prevents burst-spam within
 * a single instance. Does NOT coordinate across multiple GCF instances.
 *
 * Usage:
 *   if (isRateLimited(`${chatId}:stats`, 30_000)) {
 *       return '⏳ Подождите 30 секунд.';
 *   }
 */

const _limits = new Map(); // key → expiresAt (ms timestamp)

/**
 * Check whether `key` is currently rate-limited.
 * If not limited, records this call and returns false.
 * If limited, returns true (caller should skip the expensive operation).
 *
 * @param {string} key       Unique key — e.g. `${chatId}:stats`
 * @param {number} limitMs   Cool-down period in milliseconds
 * @returns {boolean}
 */
function isRateLimited(key, limitMs) {
    const now       = Date.now();
    const expiresAt = _limits.get(key);
    if (expiresAt !== undefined && now < expiresAt) {
        return true; // within cool-down window
    }
    _limits.set(key, now + limitMs);
    return false;
}

/**
 * Clear all recorded limits.
 * Exposed for unit tests only — do NOT call in production code.
 */
function _reset() {
    _limits.clear();
}

module.exports = { isRateLimited, _reset };
