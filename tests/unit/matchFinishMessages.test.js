'use strict';

const { getRandomFunnyMessage } = require('../../src/data/matchFinishMessages');

describe('getRandomFunnyMessage', () => {
    it('returns a non-empty string', () => {
        const result = getRandomFunnyMessage('TestPlayer', 1500);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('replaces {nick} with the given nickname', () => {
        // Run multiple times to cover different random templates
        for (let i = 0; i < 10; i++) {
            const result = getRandomFunnyMessage('s1mple', 1800);
            expect(result).toContain('s1mple');
        }
    });

    it('replaces {elo} with the given ELO value', () => {
        // Some templates use {elo} (→ currentElo), others use {left} (→ 2000-currentElo).
        // Either way an ELO-related number must be present in every output.
        const eloLeft = String(2000 - 1234); // "766"
        for (let i = 0; i < 10; i++) {
            const result = getRandomFunnyMessage('Player', 1234);
            expect(result.includes('1234') || result.includes(eloLeft)).toBe(true);
        }
    });

    it('handles ELO of 0', () => {
        const result = getRandomFunnyMessage('Noob', 0);
        expect(result).toContain('Noob');
        expect(result).toContain('0');
    });

    it('handles ELO >= 2000 (eloLeft = 0, games = 0)', () => {
        // Should not throw; eloLeft is clamped to 0
        expect(() => getRandomFunnyMessage('Pro', 2000)).not.toThrow();
        expect(typeof getRandomFunnyMessage('Pro', 2500)).toBe('string');
    });

    it('never leaves unreplaced placeholders in the output', () => {
        for (let i = 0; i < 30; i++) {
            const result = getRandomFunnyMessage('Nick', 1500);
            expect(result).not.toMatch(/\{nick\}/);
            expect(result).not.toMatch(/\{elo\}/);
            expect(result).not.toMatch(/\{left\}/);
            expect(result).not.toMatch(/\{games\}/);
        }
    });
});
