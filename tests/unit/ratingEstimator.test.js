'use strict';

const {
    DEFAULT_KAST_ESTIMATE,
    estimateMatchRating
} = require('../../src/services/ratingEstimator');

describe('estimateMatchRating', () => {
    it('returns null when rounds is 0', () => {
        expect(estimateMatchRating({ rounds: 0 })).toBeNull();
    });

    it('returns null when rounds is negative or missing', () => {
        expect(estimateMatchRating({ rounds: -5 })).toBeNull();
        expect(estimateMatchRating()).toBeNull();
    });

    it('returns a finite value in a plausible range for a typical match', () => {
        const rating = estimateMatchRating({
            kills: 20,
            deaths: 15,
            assists: 4,
            rounds: 16,
            adr: 85
        });

        expect(Number.isFinite(rating)).toBe(true);
        expect(rating).toBeGreaterThan(0.5);
        expect(rating).toBeLessThan(2.0);
    });

    it('increases when kills increase and other inputs stay fixed', () => {
        const lower = estimateMatchRating({
            kills: 12,
            deaths: 10,
            assists: 4,
            rounds: 16,
            adr: 80
        });
        const higher = estimateMatchRating({
            kills: 20,
            deaths: 10,
            assists: 4,
            rounds: 16,
            adr: 80
        });

        expect(higher).toBeGreaterThan(lower);
    });

    it('changes when a custom kast value is provided', () => {
        const withDefaultKast = estimateMatchRating({
            kills: 20,
            deaths: 10,
            assists: 5,
            rounds: 16,
            adr: 90
        });
        const withCustomKast = estimateMatchRating({
            kills: 20,
            deaths: 10,
            assists: 5,
            rounds: 16,
            adr: 90,
            kast: 80
        });

        expect(withCustomKast).not.toBe(withDefaultKast);
    });

    it('matches the documented regression formula for a fixed input', () => {
        const rating = estimateMatchRating({
            kills: 20,
            deaths: 10,
            assists: 5,
            rounds: 16,
            adr: 90,
            kast: 73
        });

        expect(rating).toBeCloseTo(1.660839, 3);
    });
});

describe('DEFAULT_KAST_ESTIMATE', () => {
    it('exports the default community-average KAST value', () => {
        expect(DEFAULT_KAST_ESTIMATE).toBe(73.0);
    });
});
