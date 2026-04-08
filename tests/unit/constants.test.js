'use strict';

const { FINISHED_STATUSES, MATCH_URL_BASE, MATCH_STATUS_LABELS } = require('../../src/constants');

describe('FINISHED_STATUSES', () => {
    it('is a Set', () => {
        expect(FINISHED_STATUSES).toBeInstanceOf(Set);
    });

    it.each(['FINISHED', 'CANCELLED', 'ABORTED', 'WALKOVER', 'DROPPED'])(
        'contains %s',
        (status) => expect(FINISHED_STATUSES.has(status)).toBe(true)
    );

    it('does not contain active statuses', () => {
        expect(FINISHED_STATUSES.has('ONGOING')).toBe(false);
        expect(FINISHED_STATUSES.has('READY')).toBe(false);
        expect(FINISHED_STATUSES.has('VOTING')).toBe(false);
        expect(FINISHED_STATUSES.has('CONFIGURING')).toBe(false);
    });
});

describe('MATCH_URL_BASE', () => {
    it('is a non-empty string', () => {
        expect(typeof MATCH_URL_BASE).toBe('string');
        expect(MATCH_URL_BASE.length).toBeGreaterThan(0);
    });

    it('starts with https://', () => {
        expect(MATCH_URL_BASE.startsWith('https://')).toBe(true);
    });
});

describe('MATCH_STATUS_LABELS', () => {
    it('has all expected status keys', () => {
        expect(MATCH_STATUS_LABELS).toHaveProperty('ONGOING');
        expect(MATCH_STATUS_LABELS).toHaveProperty('READY');
        expect(MATCH_STATUS_LABELS).toHaveProperty('VOTING');
        expect(MATCH_STATUS_LABELS).toHaveProperty('CONFIGURING');
    });

    it('each value is a non-empty string', () => {
        for (const label of Object.values(MATCH_STATUS_LABELS)) {
            expect(typeof label).toBe('string');
            expect(label.length).toBeGreaterThan(0);
        }
    });
});
