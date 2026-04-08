'use strict';

const { COMMAND_LIST, COMMANDS, BOT_COMMANDS } = require('../../src/commands');

describe('COMMAND_LIST', () => {
    it('is a non-empty array', () => {
        expect(Array.isArray(COMMAND_LIST)).toBe(true);
        expect(COMMAND_LIST.length).toBeGreaterThan(0);
    });

    it('each entry has key, command starting with /, and description', () => {
        for (const cmd of COMMAND_LIST) {
            expect(typeof cmd.key).toBe('string');
            expect(cmd.command).toMatch(/^\//);
            expect(typeof cmd.description).toBe('string');
            expect(cmd.description.length).toBeGreaterThan(0);
        }
    });

    it('contains all expected commands', () => {
        const commandStrings = COMMAND_LIST.map(c => c.command);
        expect(commandStrings).toContain('/stats');
        expect(commandStrings).toContain('/add_player');
        expect(commandStrings).toContain('/remove_player');
        expect(commandStrings).toContain('/players');
        expect(commandStrings).toContain('/help');
        expect(commandStrings).toContain('/live');
    });

    it('commands with required <arg> have prompt and placeholder defined', () => {
        const withRequiredArgs = COMMAND_LIST.filter(c => c.args && c.args.startsWith('<'));
        expect(withRequiredArgs.length).toBeGreaterThan(0); // sanity-check
        for (const cmd of withRequiredArgs) {
            expect(typeof cmd.prompt).toBe('string');
            expect(cmd.prompt.length).toBeGreaterThan(0);
            expect(typeof cmd.placeholder).toBe('string');
            expect(cmd.placeholder.length).toBeGreaterThan(0);
        }
    });

    it('all keys are unique', () => {
        const keys = COMMAND_LIST.map(c => c.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('all command strings are unique', () => {
        const cmds = COMMAND_LIST.map(c => c.command);
        expect(new Set(cmds).size).toBe(cmds.length);
    });
});

describe('COMMANDS', () => {
    it('is a plain object', () => {
        expect(typeof COMMANDS).toBe('object');
        expect(COMMANDS).not.toBeNull();
    });

    it('maps expected keys to correct command strings', () => {
        expect(COMMANDS.STATS).toBe('/stats');
        expect(COMMANDS.ADD_PLAYER).toBe('/add_player');
        expect(COMMANDS.REMOVE_PLAYER).toBe('/remove_player');
        expect(COMMANDS.PLAYERS).toBe('/players');
        expect(COMMANDS.HELP).toBe('/help');
        expect(COMMANDS.LIVE).toBe('/live');
    });

    it('has the same number of entries as COMMAND_LIST', () => {
        expect(Object.keys(COMMANDS).length).toBe(COMMAND_LIST.length);
    });
});

describe('BOT_COMMANDS', () => {
    it('is an array with the same count as COMMAND_LIST', () => {
        expect(Array.isArray(BOT_COMMANDS)).toBe(true);
        expect(BOT_COMMANDS.length).toBe(COMMAND_LIST.length);
    });

    it('strips the leading slash from every command', () => {
        for (const bc of BOT_COMMANDS) {
            expect(bc.command).not.toMatch(/^\//);
        }
    });

    it('each entry has a non-empty description', () => {
        for (const bc of BOT_COMMANDS) {
            expect(typeof bc.description).toBe('string');
            expect(bc.description.length).toBeGreaterThan(0);
        }
    });
});
