const { createCanvas, loadImage } = require('@napi-rs/canvas');

// ── Design tokens ─────────────────────────────────────────────────────────────
const COLOR = {
    bg:        '#1F1F1F',
    headerBg:  '#242424',
    rowAlt:    '#252525',
    accent:    '#FF5500',
    text:      '#FFFFFF',
    subtext:   '#9A9A9A',
    positive:  '#54C26A',
    negative:  '#F44545',
    separator: '#2E2E2E',
    avatarBg:  '#333333',
};

// ── Typography ────────────────────────────────────────────────────────────────
const FONT_FAMILY = 'sans-serif';
const FONT = {
    title:         `bold 35px ${FONT_FAMILY}`,
    subtitle:      `24px ${FONT_FAMILY}`,
    colLabel:      `bold 20px ${FONT_FAMILY}`,
    rank:          `bold 22px ${FONT_FAMILY}`,
    playerName:    `bold 24px ${FONT_FAMILY}`,
    statCell:      `22px ${FONT_FAMILY}`,
    footer:        `20px ${FONT_FAMILY}`,
    avatarInitial: (r) => `bold ${Math.round(r * 0.9)}px ${FONT_FAMILY}`,
};

// ── Layout ────────────────────────────────────────────────────────────────────
const WIDTH       = 720;
const PADDING     = 28;
const CELL_PAD    = 8;
const ACCENT_H    = 5;
const HEADER_H    = 156;
const ROW_H       = 74;
const FOOTER_H    = 46;
const AVATAR_SIZE = 48;
const AVATAR_GAP  = 12;

// Header text baseline Y positions (hand-tuned for visual balance within HEADER_H)
const HEADER_TITLE_Y    = 58;
const HEADER_SUBTITLE_Y = 96;
const HEADER_COL_Y      = 140;

// Column definitions
const COLUMNS = [
    { label: 'Player', w: 230, align: 'left'  },
    { label: 'ADR',    w: 80,  align: 'right' },
    { label: 'K/D',    w: 80,  align: 'right' },
    { label: 'Kills',  w: 80,  align: 'right' },
    { label: 'ELO',    w: 100, align: 'right' },
    { label: '± ELO',  w: 100, align: 'right' },
];

// Pre-computed column X positions (left edge of each column)
const COL_X = COLUMNS.map((_, i) =>
    COLUMNS.slice(0, i).reduce((sum, c) => sum + c.w, PADDING)
);

// Avatar geometry (derived from layout constants)
const AVATAR_R          = AVATAR_SIZE / 2;
const AVATAR_CX_OFFSET  = CELL_PAD + AVATAR_R;   // from COL_X[0] to avatar centre
const RANK_X            = COL_X[0] + CELL_PAD - AVATAR_GAP;  // right-aligned rank edge
const NAME_X            = COL_X[0] + CELL_PAD + AVATAR_SIZE + AVATAR_GAP;
const NAME_MAX_W        = COLUMNS[0].w - CELL_PAD - AVATAR_SIZE - AVATAR_GAP - CELL_PAD;

// ── Drawing primitives ────────────────────────────────────────────────────────

function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let result = text;
    while (result.length > 1 && ctx.measureText(result + '…').width > maxWidth) {
        result = result.slice(0, -1);
    }
    return result + '…';
}

function drawStatCell(ctx, text, colIndex, y, color = COLOR.text) {
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(text, COL_X[colIndex] + COLUMNS[colIndex].w - CELL_PAD, y);
}

function drawCircularAvatar(ctx, img, cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
}

function drawAvatarPlaceholder(ctx, letter, cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.avatarBg;
    ctx.fill();
    ctx.fillStyle    = COLOR.subtext;
    ctx.font         = FONT.avatarInitial(r);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((letter || '?').toUpperCase(), cx, cy);
    ctx.restore();
}

// ── Section renderers ─────────────────────────────────────────────────────────

function drawHeader(ctx, matchesCount) {
    ctx.fillStyle = COLOR.headerBg;
    ctx.fillRect(0, 0, WIDTH, HEADER_H);

    ctx.fillStyle = COLOR.accent;
    ctx.fillRect(0, 0, WIDTH, ACCENT_H);

    ctx.fillStyle = COLOR.text;
    ctx.font      = FONT.title;
    ctx.textAlign = 'left';
    ctx.fillText('FACEIT STATS', PADDING, HEADER_TITLE_Y);

    ctx.fillStyle = COLOR.subtext;
    ctx.font      = FONT.subtitle;
    ctx.fillText(`Last ${matchesCount} matches · CS2`, PADDING, HEADER_SUBTITLE_Y);

    ctx.font = FONT.colLabel;
    COLUMNS.forEach((col, i) => {
        ctx.fillStyle = COLOR.subtext;
        if (i === 0) {
            ctx.textAlign = 'left';
            ctx.fillText(col.label.toUpperCase(), PADDING, HEADER_COL_Y);
        } else {
            ctx.textAlign = 'right';
            ctx.fillText(col.label.toUpperCase(), COL_X[i] + col.w - CELL_PAD, HEADER_COL_Y);
        }
    });

    ctx.fillStyle = COLOR.separator;
    ctx.fillRect(0, HEADER_H - 1, WIDTH, 1);
}

function drawRow(ctx, player, rowIndex, avatar) {
    const rowY  = HEADER_H + rowIndex * ROW_H;
    const textY = rowY + ROW_H / 2 + 8;

    ctx.fillStyle = rowIndex % 2 === 0 ? COLOR.bg : COLOR.rowAlt;
    ctx.fillRect(0, rowY, WIDTH, ROW_H);

    ctx.fillStyle = COLOR.separator;
    ctx.fillRect(0, rowY + ROW_H - 1, WIDTH, 1);

    const avatarCx = COL_X[0] + AVATAR_CX_OFFSET;
    const avatarCy = rowY + ROW_H / 2;
    if (avatar) {
        drawCircularAvatar(ctx, avatar, avatarCx, avatarCy, AVATAR_R);
    } else {
        drawAvatarPlaceholder(ctx, player.nickname[0], avatarCx, avatarCy, AVATAR_R);
    }

    ctx.fillStyle = rowIndex === 0 ? COLOR.accent : COLOR.subtext;
    ctx.font      = FONT.rank;
    ctx.textAlign = 'right';
    ctx.fillText(String(rowIndex + 1), RANK_X, textY);

    ctx.fillStyle = COLOR.text;
    ctx.font      = FONT.playerName;
    ctx.textAlign = 'left';
    ctx.fillText(truncateText(ctx, player.nickname, NAME_MAX_W), NAME_X, textY);

    ctx.font = FONT.statCell;
    drawStatCell(ctx, parseFloat(player.average_damage_per_round).toFixed(1), 1, textY);
    drawStatCell(ctx, parseFloat(player.kills_deaths_ratio).toFixed(2),       2, textY);
    drawStatCell(ctx, parseFloat(player.average_kills).toFixed(1),            3, textY);
    drawStatCell(ctx, player.current_elo != null ? String(player.current_elo) : '—', 4, textY, COLOR.subtext);

    const eloText  = player.elo_change != null
        ? `${player.elo_change >= 0 ? '+' : ''}${player.elo_change}`
        : '—';
    const eloColor = player.elo_change > 0 ? COLOR.positive
                   : player.elo_change < 0 ? COLOR.negative
                   : COLOR.subtext;
    drawStatCell(ctx, eloText, 5, textY, eloColor);
}

function drawFooter(ctx, playerCount) {
    const footerY = HEADER_H + playerCount * ROW_H;
    ctx.fillStyle = COLOR.headerBg;
    ctx.fillRect(0, footerY, WIDTH, FOOTER_H);
    ctx.fillStyle = COLOR.subtext;
    ctx.font      = FONT.footer;
    ctx.textAlign = 'right';
    ctx.fillText('FACEIT Stats Bot', WIDTH - PADDING, footerY + FOOTER_H / 2 + 6);
}

async function loadAvatars(leaderboard) {
    return Promise.all(
        leaderboard.map(async ({ avatar_url }) => {
            if (!avatar_url) return null;
            try { return await loadImage(avatar_url); } catch { return null; }
        })
    );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates a FACEIT-styled stats card as a PNG buffer.
 * @param {Array}  leaderboard   Sorted player stat objects from faceitService
 * @param {number} matchesCount  Number of matches analysed
 * @returns {Promise<Buffer>}
 */
async function generateStatsImage(leaderboard, matchesCount) {
    const avatars = await loadAvatars(leaderboard);

    const canvas = createCanvas(WIDTH, HEADER_H + leaderboard.length * ROW_H + FOOTER_H);
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawHeader(ctx, matchesCount);
    leaderboard.forEach((player, i) => drawRow(ctx, player, i, avatars[i]));
    drawFooter(ctx, leaderboard.length);

    return canvas.toBuffer('image/png');
}

module.exports = { generateStatsImage };
