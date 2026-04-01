/** FACEIT match statuses that mean a match is definitively over */
const FINISHED_STATUSES = new Set(['FINISHED', 'CANCELLED', 'ABORTED', 'WALKOVER', 'DROPPED']);

/** Base URL for FACEIT match room links */
const MATCH_URL_BASE = 'https://www.faceit.com/en/cs2/room';

/** Human-readable labels for match statuses (used in bot messages and /live) */
const MATCH_STATUS_LABELS = {
    ONGOING:     '🟢 Идёт',
    READY:       '🟠 Старт',
    VOTING:      '🟡 Голосование',
    CONFIGURING: '⚪ Настройка',
};

module.exports = { FINISHED_STATUSES, MATCH_URL_BASE, MATCH_STATUS_LABELS };
