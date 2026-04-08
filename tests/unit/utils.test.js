'use strict';

const { escapeHtml } = require('../../src/utils');

describe('escapeHtml', () => {
    it('escapes & to &amp;', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes < to &lt;', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('escapes > to &gt;', () => {
        expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('escapes " to &quot;', () => {
        expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    });

    it('escapes all special chars in one string', () => {
        expect(escapeHtml('<a href="x&y">text</a>'))
            .toBe('&lt;a href=&quot;x&amp;y&quot;&gt;text&lt;/a&gt;');
    });

    it('returns empty string unchanged', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('converts non-string values to string first', () => {
        expect(escapeHtml(42)).toBe('42');
        expect(escapeHtml(null)).toBe('null');
    });

    it('does not modify plain text without special chars', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });
});
