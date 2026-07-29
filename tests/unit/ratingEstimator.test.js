'use strict';

const {
    DEFAULT_KAST_ESTIMATE,
    FACEIT_BASELINE_SCALE,
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

    it('matches the documented regression formula rescaled to the FACEIT baseline for a fixed input', () => {
        const rating = estimateMatchRating({
            kills: 20,
            deaths: 10,
            assists: 5,
            rounds: 16,
            adr: 90,
            kast: 73
        });

        expect(rating).toBeCloseTo(1.660839 * FACEIT_BASELINE_SCALE, 3);
    });
});

describe('estimateMatchRating — multi-kill / MVP / entry / clutch bonuses', () => {
    const BASE_INPUT = { kills: 20, deaths: 10, assists: 5, rounds: 16, adr: 90, kast: 73 };

    it('increases rating when triple/quadro/penta/double kills are provided', () => {
        const base = estimateMatchRating(BASE_INPUT);
        const withTriple = estimateMatchRating({ ...BASE_INPUT, tripleKills: 1 });
        const withQuadro = estimateMatchRating({ ...BASE_INPUT, quadroKills: 1 });
        const withPenta = estimateMatchRating({ ...BASE_INPUT, pentaKills: 1 });
        const withDouble = estimateMatchRating({ ...BASE_INPUT, doubleKills: 1 });

        expect(withTriple).toBeGreaterThan(base);
        expect(withQuadro).toBeGreaterThan(withTriple);
        expect(withPenta).toBeGreaterThan(withQuadro);
        expect(withDouble).toBeGreaterThan(base);
    });

    it('increases rating with MVP count', () => {
        const base = estimateMatchRating(BASE_INPUT);
        const withMvps = estimateMatchRating({ ...BASE_INPUT, mvps: 4 });

        expect(withMvps).toBeGreaterThan(base);
    });

    it('increases rating with entry duel wins', () => {
        const base = estimateMatchRating(BASE_INPUT);
        const withEntry = estimateMatchRating({ ...BASE_INPUT, entryWins: 3 });

        expect(withEntry).toBeGreaterThan(base);
    });

    it('increases rating with clutch round wins, weighting 1v2 higher than 1v1', () => {
        const base = estimateMatchRating(BASE_INPUT);
        const with1v1 = estimateMatchRating({ ...BASE_INPUT, clutch1v1Wins: 1 });
        const with1v2 = estimateMatchRating({ ...BASE_INPUT, clutch1v2Wins: 1 });

        expect(with1v1).toBeGreaterThan(base);
        expect(with1v2).toBeGreaterThan(with1v1);
    });

    it('ignores non-finite bonus fields and falls back to 0', () => {
        const base = estimateMatchRating(BASE_INPUT);
        const withInvalid = estimateMatchRating({ ...BASE_INPUT, mvps: NaN, entryWins: undefined });

        expect(withInvalid).toBe(base);
    });
});

describe('FACEIT_BASELINE_SCALE', () => {
    it('exports the HLTV-2.0-to-FACEIT-baseline calibration constant', () => {
        expect(FACEIT_BASELINE_SCALE).toBe(1.03);
    });
});

describe('DEFAULT_KAST_ESTIMATE', () => {
    it('exports the default community-average KAST value', () => {
        expect(DEFAULT_KAST_ESTIMATE).toBe(73.0);
    });
});
