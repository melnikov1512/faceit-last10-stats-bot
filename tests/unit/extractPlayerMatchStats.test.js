'use strict';

const { extractPlayerMatchStats } = require('../../src/services/faceitService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMatchStats({ players1 = [], players2 = [], f1Score = 16, f2Score = 14, map = 'de_dust2' } = {}) {
    return {
        rounds: [{
            round_stats: { Map: map },
            teams: [
                { team_stats: { 'Final Score': String(f1Score) }, players: players1 },
                { team_stats: { 'Final Score': String(f2Score) }, players: players2 },
            ],
        }],
    };
}

function makePlayer(id, stats = {}) {
    return {
        player_id: id,
        player_stats: {
            'Kills':       String(stats.kills  ?? 20),
            'Deaths':      String(stats.deaths ?? 10),
            'Assists':     String(stats.assists ?? 5),
            'K/D Ratio':   String(stats.kd     ?? 2.0),
            'ADR':         String(stats.adr    ?? 80),
            'Headshots %': String(stats.hs     ?? 50),
            'Result':      String(stats.result ?? 1),
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractPlayerMatchStats — null / empty input', () => {
    it('returns null for null matchStats', () => {
        expect(extractPlayerMatchStats(null, 'p1')).toBeNull();
    });

    it('returns null for undefined matchStats', () => {
        expect(extractPlayerMatchStats(undefined, 'p1')).toBeNull();
    });

    it('returns null for empty rounds array', () => {
        expect(extractPlayerMatchStats({ rounds: [] }, 'p1')).toBeNull();
    });

    it('returns null when player is not found in any team', () => {
        const stats = makeMatchStats({ players1: [makePlayer('p2')] });
        expect(extractPlayerMatchStats(stats, 'p1')).toBeNull();
    });
});

describe('extractPlayerMatchStats — basic stats', () => {
    it('extracts all stats fields for player in first team', () => {
        const p = makePlayer('p1', { kills: 25, deaths: 12, assists: 4, kd: 2.08, adr: 91.5, hs: 40, result: 1 });
        const result = extractPlayerMatchStats(makeMatchStats({ players1: [p] }), 'p1');

        expect(result).not.toBeNull();
        expect(result.kills).toBe(25);
        expect(result.deaths).toBe(12);
        expect(result.assists).toBe(4);
        expect(result.adr).toBe(91.5);
        expect(result.hsPercent).toBe(40);
        expect(result.result).toBe(1);
        expect(result.map).toBe('de_dust2');
    });

    it('extracts stats for player in second team', () => {
        const p = makePlayer('p2', { kills: 10, deaths: 18, result: 0 });
        const result = extractPlayerMatchStats(makeMatchStats({ players2: [p] }), 'p2');

        expect(result).not.toBeNull();
        expect(result.kills).toBe(10);
        expect(result.result).toBe(0);
    });
});

describe('extractPlayerMatchStats — teamScore / opponentScore', () => {
    it('returns correct teamScore and opponentScore for player in first team', () => {
        const p = makePlayer('p1');
        const result = extractPlayerMatchStats(makeMatchStats({ players1: [p], f1Score: 16, f2Score: 12 }), 'p1');

        expect(result.teamScore).toBe(16);
        expect(result.opponentScore).toBe(12);
    });

    it('returns correct teamScore and opponentScore for player in second team', () => {
        const p = makePlayer('p2');
        const result = extractPlayerMatchStats(makeMatchStats({ players2: [p], f1Score: 13, f2Score: 16 }), 'p2');

        // Second team won 16:13
        expect(result.teamScore).toBe(16);
        expect(result.opponentScore).toBe(13);
    });

    it('returns null scores when Final Score is absent', () => {
        const stats = {
            rounds: [{
                round_stats: { Map: 'de_mirage' },
                teams: [
                    { team_stats: {}, players: [makePlayer('p1')] },
                    { team_stats: {}, players: [] },
                ],
            }],
        };
        const result = extractPlayerMatchStats(stats, 'p1');
        expect(result.teamScore).toBeNull();
        expect(result.opponentScore).toBeNull();
    });

    it('supports lower-case "final_score" fallback', () => {
        const stats = {
            rounds: [{
                round_stats: { Map: 'de_nuke' },
                teams: [
                    { team_stats: { final_score: '9' }, players: [makePlayer('p1')] },
                    { team_stats: { final_score: '16' }, players: [] },
                ],
            }],
        };
        const result = extractPlayerMatchStats(stats, 'p1');
        expect(result.teamScore).toBe(9);
        expect(result.opponentScore).toBe(16);
    });

    it('returns null opponentScore when opponent team is missing', () => {
        const stats = {
            rounds: [{
                round_stats: { Map: 'de_cache' },
                teams: [
                    { team_stats: { 'Final Score': '16' }, players: [makePlayer('p1')] },
                    // second team absent
                ],
            }],
        };
        const result = extractPlayerMatchStats(stats, 'p1');
        expect(result.teamScore).toBe(16);
        expect(result.opponentScore).toBeNull();
    });
});
