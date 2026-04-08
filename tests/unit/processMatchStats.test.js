'use strict';

const { processMatchStats } = require('../../src/handlers/apiHandler');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRound({ mapName = 'de_dust2', winnerTeamId = null, f1Id = 'f1', f2Id = 'f2', f1Score = 16, f2Score = 14, players1 = [], players2 = [] } = {}) {
    return {
        round_stats: { Map: mapName, Winner: winnerTeamId },
        teams: [
            {
                team_id: f1Id,
                team_stats: { 'Final Score': String(f1Score) },
                players: players1,
            },
            {
                team_id: f2Id,
                team_stats: { 'Final Score': String(f2Score) },
                players: players2,
            },
        ],
    };
}

function makePlayer(id, nickname, stats = {}) {
    return {
        player_id: id,
        nickname,
        player_stats: {
            Kills:      String(stats.kills      ?? 20),
            Deaths:     String(stats.deaths     ?? 10),
            Assists:    String(stats.assists     ?? 5),
            Headshots:  String(stats.headshots  ?? 10),
            ADR:        String(stats.adr        ?? 80.0),
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processMatchStats — null / empty input', () => {
    it('returns null for null input', () => {
        expect(processMatchStats(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
        expect(processMatchStats(undefined)).toBeNull();
    });

    it('returns null for empty rounds array', () => {
        expect(processMatchStats({ rounds: [] })).toBeNull();
    });

    it('returns null for object without rounds', () => {
        expect(processMatchStats({})).toBeNull();
    });
});

describe('processMatchStats — single map', () => {
    it('returns correct map info', () => {
        const stats = { rounds: [makeRound({ mapName: 'de_mirage', winnerTeamId: 'f1', f1Score: 16, f2Score: 12 })] };
        const result = processMatchStats(stats, 'f1', 'f2');

        expect(result.maps).toHaveLength(1);
        expect(result.maps[0]).toEqual({
            map: 'de_mirage',
            f1_score: 16,
            f2_score: 12,
            winner: 'faction1',
        });
    });

    it('processes player stats correctly', () => {
        const p1 = makePlayer('p1', 'Player1', { kills: 20, deaths: 10, assists: 5, headshots: 10, adr: 80.5 });
        const stats = {
            rounds: [makeRound({ players1: [p1] })],
        };
        const result = processMatchStats(stats, 'f1', 'f2');

        const player = result.players['p1'];
        expect(player.nickname).toBe('Player1');
        expect(player.kills).toBe(20);
        expect(player.deaths).toBe(10);
        expect(player.assists).toBe(5);
        expect(player.kd).toBe('2.00');
        expect(player.adr).toBe('80.5');
        expect(player.hs_pct).toBe(50);
        expect(player.faction).toBe('faction1');
    });

    it('assigns faction2 to players in the second team', () => {
        const p2 = makePlayer('p2', 'Player2');
        const stats = {
            rounds: [makeRound({ players2: [p2] })],
        };
        const result = processMatchStats(stats, 'f1', 'f2');
        expect(result.players['p2'].faction).toBe('faction2');
    });
});

describe('processMatchStats — multiple maps (accumulation)', () => {
    it('sums kills, deaths, assists across maps', () => {
        const p = makePlayer('p1', 'P1', { kills: 15, deaths: 8, assists: 3, headshots: 5, adr: 60 });
        const rounds = [
            makeRound({ players1: [p] }),
            makeRound({ players1: [p] }),
        ];
        const result = processMatchStats({ rounds }, 'f1', 'f2');
        const player = result.players['p1'];

        expect(player.kills).toBe(30);
        expect(player.deaths).toBe(16);
        expect(player.assists).toBe(6);
    });

    it('averages ADR across maps', () => {
        const p = makePlayer('p1', 'P1', { adr: 60 });
        const rounds = [makeRound({ players1: [p] }), makeRound({ players1: [p] })];
        const result = processMatchStats({ rounds }, 'f1', 'f2');
        expect(result.players['p1'].adr).toBe('60.0'); // (60 + 60) / 2
    });

    it('returns one map entry per round', () => {
        const rounds = [
            makeRound({ mapName: 'de_dust2' }),
            makeRound({ mapName: 'de_nuke' }),
            makeRound({ mapName: 'de_inferno' }),
        ];
        const result = processMatchStats({ rounds }, 'f1', 'f2');
        expect(result.maps).toHaveLength(3);
        expect(result.maps.map(m => m.map)).toEqual(['de_dust2', 'de_nuke', 'de_inferno']);
    });
});

describe('processMatchStats — edge cases', () => {
    it('handles zero deaths — K/D equals kills (no division by zero)', () => {
        const p = makePlayer('p1', 'Deathless', { kills: 5, deaths: 0 });
        const result = processMatchStats({ rounds: [makeRound({ players1: [p] })] }, 'f1', 'f2');
        expect(result.players['p1'].kd).toBe('5.00');
    });

    it('handles zero kills — HS% is 0 (no division by zero)', () => {
        const p = makePlayer('p1', 'Noob', { kills: 0, headshots: 0 });
        const result = processMatchStats({ rounds: [makeRound({ players1: [p] })] }, 'f1', 'f2');
        expect(result.players['p1'].hs_pct).toBe(0);
    });

    it('winner is null when winnerTeamId is unknown', () => {
        const stats = { rounds: [makeRound({ winnerTeamId: 'unknown-id' })] };
        const result = processMatchStats(stats, 'f1', 'f2');
        expect(result.maps[0].winner).toBeNull();
    });

    it('winner is null when winnerTeamId is absent', () => {
        const stats = { rounds: [makeRound({ winnerTeamId: null })] };
        const result = processMatchStats(stats, 'f1', 'f2');
        expect(result.maps[0].winner).toBeNull();
    });

    it('handles missing faction IDs gracefully', () => {
        const p = makePlayer('p1', 'Solo', { kills: 10, deaths: 5 });
        const stats = {
            rounds: [
                {
                    round_stats: { Map: 'de_dust2' },
                    teams: [{ team_id: 'team-x', team_stats: { 'Final Score': '1' }, players: [p] }],
                },
            ],
        };
        const result = processMatchStats(stats, null, null);
        // player_id appears but faction is null since no IDs matched
        expect(result.players['p1']).toBeDefined();
        expect(result.players['p1'].faction).toBeNull();
    });

    it('handles missing player_stats fields gracefully (defaults to 0)', () => {
        const p = { player_id: 'p1', nickname: 'Empty', player_stats: {} };
        const result = processMatchStats({ rounds: [makeRound({ players1: [p] })] }, 'f1', 'f2');
        const player = result.players['p1'];
        expect(player.kills).toBe(0);
        expect(player.deaths).toBe(0);
        expect(player.kd).toBe('0.00');
        expect(player.adr).toBe('0.0');
        expect(player.hs_pct).toBe(0);
    });

    it('uses "final_score" (lower-case) as fallback for team score', () => {
        const round = {
            round_stats: { Map: 'de_cache' },
            teams: [
                { team_id: 'f1', team_stats: { final_score: '10' }, players: [] },
                { team_id: 'f2', team_stats: { final_score: '6' },  players: [] },
            ],
        };
        const result = processMatchStats({ rounds: [round] }, 'f1', 'f2');
        expect(result.maps[0].f1_score).toBe(10);
        expect(result.maps[0].f2_score).toBe(6);
    });
});
