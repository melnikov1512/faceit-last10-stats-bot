const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// Register bundled Inter fonts so rendering is identical in every environment.
// Fallback to system sans-serif only if files are missing (e.g. in unit tests).
const FONTS_DIR = path.join(__dirname, '../assets/fonts');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Inter-Regular.woff2'), 'Inter');
GlobalFonts.registerFromPath(path.join(FONTS_DIR, 'Inter-Bold.woff2'),    'Inter');

// ── Design tokens ─────────────────────────────────────────────────────────────
// Palette is aligned with the web app (public/index.html) CSS variables:
// --bg:#121212  --card:#1E1E1E  --card2:#2A2A2A  --divider:rgba(255,255,255,0.07)
const COLOR = {
    pageBg:    '#121212',                   // inter-card gap / page background
    bg:        '#1E1E1E',                   // card surface  (--card)
    headerBg:  '#2A2A2A',                   // elevated sections: header, footer, player-card bg (--card2)
    rowAlt:    '#252525',                   // subtle alternating row tint
    accent:    '#FF5500',                   // brand orange  (--orange)
    text:      '#FFFFFF',                   // primary text  (--text)
    subtext:   '#9E9E9E',                   // secondary text (--text-sub)
    positive:  '#52BC6A',                   // win / ELO up  (--green)
    negative:  '#FF5757',                   // lose / ELO down (--red)
    separator: 'rgba(255,255,255,0.07)',    // hairline dividers (--divider)
    avatarBg:  '#2A2A2A',                   // avatar placeholder background
    trackedBg: 'rgba(255,85,0,0.06)',       // tracked-player row tint (matches web app)
};

// ── Typography ────────────────────────────────────────────────────────────────
const FONT_FAMILY = 'Inter';
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
    // Subtle gradient: header transitions from slightly lighter top to card surface
    const headerGrad = ctx.createLinearGradient(0, 0, 0, HEADER_H);
    headerGrad.addColorStop(0, COLOR.headerBg);
    headerGrad.addColorStop(1, '#222222');
    ctx.fillStyle = headerGrad;
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

// ── Match notification image ──────────────────────────────────────────────────

const MATCH = {
    WIDTH:        580,
    PADDING:      24,
    ACCENT_H:     4,
    HEADER_H:     72,   // title + meta, tight
    TEAM_H:       64,   // one team row
    DIVIDER_H:    1,
    FOOTER_H:     34,
    BADGE_R:      5,
};

/**
 * Draws a rounded rectangle path (no fill/stroke — caller decides).
 */
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/**
 * Draws one team row: name (left), ELO + win% pill (right).
 * Tracked team gets orange left accent + brighter name.
 */
function drawTeamBlock(ctx, team, y) {
    const { WIDTH: W, PADDING: P, TEAM_H, BADGE_R } = MATCH;
    const hasTracked = team.trackedPlayers.length > 0;

    ctx.fillStyle = hasTracked ? COLOR.trackedBg : COLOR.bg;
    ctx.fillRect(0, y, W, TEAM_H);

    if (hasTracked) {
        ctx.fillStyle = COLOR.accent;
        ctx.fillRect(0, y, 2, TEAM_H);
    }

    ctx.fillStyle = COLOR.separator;
    ctx.fillRect(0, y + TEAM_H - 1, W, 1);

    const textY = y + TEAM_H / 2 + 7;

    // Team name — if tracked players present, shift up to make room for second line
    const nameY = hasTracked ? y + TEAM_H / 2 - 4 : textY;

    ctx.fillStyle = hasTracked ? COLOR.text : COLOR.subtext;
    ctx.font      = `bold 20px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(truncateText(ctx, team.name, W - P * 2 - 100), P + 8, nameY);

    // Tracked player nicknames (second line, orange)
    if (hasTracked) {
        ctx.fillStyle = COLOR.accent;
        ctx.font      = `13px ${FONT_FAMILY}`;
        ctx.fillText(team.trackedPlayers.join('  ·  '), P + 8, nameY + 20);
    }

    // Right side: ELO and win% pill
    let rightX = W - P;

    if (team.winProb != null) {
        const pct      = Math.round(team.winProb * 100);
        const label    = `${pct}%`;
        ctx.font       = `bold 17px ${FONT_FAMILY}`;
        const pillW    = ctx.measureText(label).width + 18;
        const pillH    = 26;
        const pillX    = rightX - pillW;
        const pillY    = y + TEAM_H / 2 - pillH / 2;
        const pillColor = hasTracked ? COLOR.accent : 'rgba(255,255,255,0.08)';

        roundRect(ctx, pillX, pillY, pillW, pillH, BADGE_R);
        ctx.fillStyle = pillColor;
        ctx.fill();
        ctx.fillStyle = hasTracked ? COLOR.text : COLOR.subtext;
        ctx.textAlign = 'center';
        ctx.fillText(label, pillX + pillW / 2, pillY + 17);

        rightX = pillX - 10;
    }

    if (team.elo != null) {
        ctx.fillStyle = COLOR.subtext;
        ctx.font      = `bold 18px ${FONT_FAMILY}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${team.elo} ELO`, rightX, textY);
    }
}

/**
 * Generates a match notification image.
 * @param {{
 *   team1: { name: string, elo: number|null, winProb: number|null, trackedPlayers: string[] },
 *   team2: { name: string, elo: number|null, winProb: number|null, trackedPlayers: string[] },
 *   competition: string|null,
 *   region: string|null,
 *   bestOf: number|null,
 * }} matchInfo
 * @returns {Promise<Buffer>}
 */
async function generateMatchImage(matchInfo) {
    const { team1, team2, competition, region, bestOf } = matchInfo;
    const { WIDTH: W, PADDING: P, ACCENT_H, HEADER_H, TEAM_H, DIVIDER_H, FOOTER_H } = MATCH;
    const HEIGHT = ACCENT_H + HEADER_H + TEAM_H + DIVIDER_H + TEAM_H + FOOTER_H;

    const canvas = createCanvas(W, HEIGHT);
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, W, HEIGHT);

    // ── Header ────────────────────────────────────────────────────────────────
    const matchHdrGrad = ctx.createLinearGradient(0, 0, 0, ACCENT_H + HEADER_H);
    matchHdrGrad.addColorStop(0, COLOR.headerBg);
    matchHdrGrad.addColorStop(1, '#222222');
    ctx.fillStyle = matchHdrGrad;
    ctx.fillRect(0, 0, W, ACCENT_H + HEADER_H);

    ctx.fillStyle = COLOR.accent;
    ctx.fillRect(0, 0, W, ACCENT_H);

    // Title
    ctx.fillStyle = COLOR.text;
    ctx.font      = `bold 24px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText('MATCH FOUND', P, ACCENT_H + 36);

    // Meta
    const metaParts = [competition, region, bestOf ? `BO${bestOf}` : null].filter(Boolean);
    ctx.fillStyle = COLOR.subtext;
    ctx.font      = `15px ${FONT_FAMILY}`;
    ctx.fillText(metaParts.length ? metaParts.join('  ·  ') : 'CS2', P, ACCENT_H + 60);

    // VS
    ctx.fillStyle = COLOR.accent;
    ctx.font      = `bold 26px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.fillText('VS', W - P, ACCENT_H + 50);

    ctx.fillStyle = COLOR.separator;
    ctx.fillRect(0, ACCENT_H + HEADER_H - 1, W, 1);

    // ── Teams ─────────────────────────────────────────────────────────────────
    const teamsY = ACCENT_H + HEADER_H;
    drawTeamBlock(ctx, team1, teamsY);

    ctx.fillStyle = COLOR.separator;
    ctx.fillRect(0, teamsY + TEAM_H, W, DIVIDER_H);

    drawTeamBlock(ctx, team2, teamsY + TEAM_H + DIVIDER_H);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = HEIGHT - FOOTER_H;
    ctx.fillStyle = COLOR.headerBg;
    ctx.fillRect(0, footerY, W, FOOTER_H);
    ctx.fillStyle = COLOR.subtext;
    ctx.font      = `13px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.fillText('FACEIT Stats Bot', W - P, footerY + FOOTER_H / 2 + 4);

    return canvas.toBuffer('image/png');
}

// ── FACEIT skill level colours ────────────────────────────────────────────────
// Colours match the web app's skill-bar segments exactly:
//   sl-1…3 → grey  sl-4…6 → green  sl-7…8 → gold  sl-9 → orange  sl-10 → brand orange
const SKILL_COLOR = {
    1:  '#888888',
    2:  '#888888',
    3:  '#888888',
    4:  '#5FBA53',
    5:  '#5FBA53',
    6:  '#5FBA53',
    7:  '#FFC400',
    8:  '#FFC400',
    9:  '#FF8500',
    10: '#FF5500',
};

const DEG = Math.PI / 180;

function skillColor(level) {
    return SKILL_COLOR[level] ?? COLOR.subtext;
}

/**
 * Draws a FACEIT-style skill badge:
 * dark circle + coloured arc (gap at bottom) + coloured level number inside.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number|null} level  1-10
 * @param {number} cx   centre X
 * @param {number} cy   centre Y
 * @param {number} r    outer radius of the badge circle
 */
function drawSkillBadge(ctx, level, cx, cy, r) {
    const color   = skillColor(level);
    const lineW   = Math.max(2.5, r * 0.17);
    const arcR    = r - lineW / 2;

    ctx.save();

    // Dark background circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#161616';
    ctx.fill();

    // Coloured arc — gap at bottom centre (60°→120°, clockwise = 300° arc)
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, 120 * DEG, 60 * DEG, false);
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineW;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Level number
    ctx.fillStyle    = color;
    ctx.font         = `bold ${Math.round(r * 0.82)}px ${FONT_FAMILY}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(level != null ? String(level) : '?', cx, cy);

    ctx.restore();
}

// ── Player card (for add/remove responses) ────────────────────────────────────

const CARD = {
    WIDTH:    500,
    PADDING:  24,
    ACCENT_H: 4,
    HEIGHT:   116,
    AVATAR_R: 38,
    BADGE_R:  22,   // standalone skill badge radius
};

/**
 * Generates a player info card (add/remove confirmation).
 * Layout: [avatar] [badge] [nickname / ELO]   action label top-right
 * @param {{ nickname, avatar, elo, skillLevel }} player
 * @param {'added'|'removed'} action
 * @returns {Promise<Buffer>}
 */
async function generatePlayerCard(player, action) {
    const { WIDTH: W, PADDING: P, ACCENT_H, HEIGHT, AVATAR_R, BADGE_R } = CARD;

    let avatar = null;
    if (player.avatar) {
        try { avatar = await loadImage(player.avatar); } catch { /* fallback */ }
    }

    const canvas = createCanvas(W, HEIGHT);
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle = COLOR.headerBg;
    ctx.fillRect(0, 0, W, HEIGHT);

    ctx.fillStyle = COLOR.accent;
    ctx.fillRect(0, 0, W, ACCENT_H);

    const midY    = HEIGHT / 2 + ACCENT_H / 2;
    const avatarCx = P + AVATAR_R;

    // Avatar
    if (avatar) {
        drawCircularAvatar(ctx, avatar, avatarCx, midY, AVATAR_R);
    } else {
        drawAvatarPlaceholder(ctx, player.nickname?.[0], avatarCx, midY, AVATAR_R);
    }

    // Standalone skill badge (right of avatar, same vertical centre)
    const badgeCx = avatarCx + AVATAR_R + 14 + BADGE_R;
    drawSkillBadge(ctx, player.skillLevel, badgeCx, midY, BADGE_R);

    // Text block (right of badge)
    const textX = badgeCx + BADGE_R + 16;

    ctx.fillStyle    = COLOR.text;
    ctx.font         = `bold 24px ${FONT_FAMILY}`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(player.nickname ?? '—', textX, midY - 4);

    ctx.fillStyle = COLOR.text;
    ctx.font      = `bold 20px ${FONT_FAMILY}`;
    ctx.fillText(player.elo != null ? `${player.elo} ELO` : '—', textX, midY + 22);

    // Action label (top-right)
    const actionLabel = action === 'added' ? 'Player added' : 'Player removed';
    const actionColor = action === 'added' ? COLOR.positive : COLOR.negative;
    ctx.fillStyle    = actionColor;
    ctx.font         = `bold 13px ${FONT_FAMILY}`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(actionLabel, W - P, ACCENT_H + 18);

    return canvas.toBuffer('image/png');
}

// ── Players list image (for /players) ─────────────────────────────────────────

const PLIST = {
    WIDTH:    540,
    PADDING:  28,
    ACCENT_H: 4,
    HEADER_H: 52,
    ROW_H:    68,
    FOOTER_H: 32,
    AVATAR_R: 24,
    BADGE_R:  16,  // standalone badge next to avatar
};

/**
 * Generates a players list image.
 * @param {Array<{ playerId, nickname, avatar, elo, skillLevel }>} players
 * @returns {Promise<Buffer>}
 */
async function generatePlayersListImage(players) {
    const { WIDTH: W, PADDING: P, ACCENT_H, HEADER_H, ROW_H, FOOTER_H, AVATAR_R, BADGE_R } = PLIST;
    const HEIGHT = ACCENT_H + HEADER_H + players.length * ROW_H + FOOTER_H;

    const avatars = await Promise.all(players.map(async ({ avatar }) => {
        if (!avatar) return null;
        try { return await loadImage(avatar); } catch { return null; }
    }));

    const canvas = createCanvas(W, HEIGHT);
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, W, HEIGHT);

    // ── Header ────────────────────────────────────────────────────────────────
    const listHdrGrad = ctx.createLinearGradient(0, 0, 0, ACCENT_H + HEADER_H);
    listHdrGrad.addColorStop(0, COLOR.headerBg);
    listHdrGrad.addColorStop(1, '#222222');
    ctx.fillStyle = listHdrGrad;
    ctx.fillRect(0, 0, W, ACCENT_H + HEADER_H);

    ctx.fillStyle = COLOR.accent;
    ctx.fillRect(0, 0, W, ACCENT_H);

    ctx.fillStyle    = COLOR.text;
    ctx.font         = `bold 22px ${FONT_FAMILY}`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('TRACKED PLAYERS', P, ACCENT_H + 34);

    ctx.fillStyle = COLOR.subtext;
    ctx.font      = `14px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${players.length} player${players.length !== 1 ? 's' : ''}`, W - P, ACCENT_H + 34);

    ctx.fillStyle = COLOR.separator;
    ctx.fillRect(0, ACCENT_H + HEADER_H - 1, W, 1);

    // ── Rows ──────────────────────────────────────────────────────────────────
    players.forEach((player, i) => {
        const rowY  = ACCENT_H + HEADER_H + i * ROW_H;
        const midY  = rowY + ROW_H / 2;
        const textY = midY + 6;

        ctx.fillStyle = i % 2 === 0 ? COLOR.bg : COLOR.rowAlt;
        ctx.fillRect(0, rowY, W, ROW_H);

        ctx.fillStyle = COLOR.separator;
        ctx.fillRect(0, rowY + ROW_H - 1, W, 1);

        // Rank
        ctx.fillStyle    = i === 0 ? COLOR.accent : COLOR.subtext;
        ctx.font         = `bold 14px ${FONT_FAMILY}`;
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(String(i + 1), P - 8, textY);

        // Avatar
        const avatarCx = P + AVATAR_R;
        if (avatars[i]) {
            drawCircularAvatar(ctx, avatars[i], avatarCx, midY, AVATAR_R);
        } else {
            drawAvatarPlaceholder(ctx, player.nickname?.[0], avatarCx, midY, AVATAR_R);
        }

        // Skill badge (standalone, right of avatar)
        const badgeCx = avatarCx + AVATAR_R + 10 + BADGE_R;
        drawSkillBadge(ctx, player.skillLevel, badgeCx, midY, BADGE_R);

        // Nickname
        const nameX = badgeCx + BADGE_R + 14;
        ctx.fillStyle    = COLOR.text;
        ctx.font         = `bold 18px ${FONT_FAMILY}`;
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(truncateText(ctx, player.nickname, W - nameX - P - 90), nameX, textY);

        // ELO (right, white + bold)
        ctx.fillStyle = COLOR.text;
        ctx.font      = `bold 18px ${FONT_FAMILY}`;
        ctx.textAlign = 'right';
        ctx.fillText(player.elo != null ? `${player.elo}` : '—', W - P, midY - 4);

        ctx.fillStyle = COLOR.subtext;
        ctx.font      = `13px ${FONT_FAMILY}`;
        ctx.fillText('ELO', W - P, midY + 14);
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = HEIGHT - FOOTER_H;
    ctx.fillStyle = COLOR.headerBg;
    ctx.fillRect(0, footerY, W, FOOTER_H);
    ctx.fillStyle    = COLOR.subtext;
    ctx.font         = `12px ${FONT_FAMILY}`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('FACEIT Stats Bot', W - P, footerY + FOOTER_H / 2 + 4);

    return canvas.toBuffer('image/png');
}

// ── Match result image (finish notification) ──────────────────────────────────

const RESULT_CARD = {
    WIDTH:    540,
    PADDING:  24,
    ACCENT_H: 4,
    HEADER_H: 76,
    PLAYER_H: 72,
    STATS_H:  72,
    FOOTER_H: 30,
    AVATAR_R: 28,
    BADGE_R:  16,
};

// Pre-computed card height — used by both public functions
const RESULT_CARD_H = (() => {
    const { ACCENT_H, HEADER_H, PLAYER_H, STATS_H, FOOTER_H } = RESULT_CARD;
    return ACCENT_H + HEADER_H + PLAYER_H + 1 + STATS_H + FOOTER_H;
})();

/**
 * Safely load an avatar image; returns null on any error.
 * @param {string|null} url
 * @returns {Promise<Image|null>}
 */
async function _loadAvatar(url) {
    if (!url) return null;
    try { return await loadImage(url); } catch { return null; }
}

/**
 * Draws a single match result card onto `ctx` starting at `offsetY`.
 * Pure drawing function — does NOT load the avatar (pass pre-loaded image or null).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} data  — same shape as generateMatchResultImage parameter
 * @param {number} offsetY  — Y coordinate where the card top begins
 * @param {Image|null} avatar  — pre-loaded avatar image or null for placeholder
 */
function _drawMatchResultCard(ctx, data, offsetY, avatar) {
    const {
        nickname, skillLevel,
        currentElo, eloChange,
        kills, assists, kd, adr, hsPercent, result,
        competition, map,
        teamScore, opponentScore,
    } = data;

    const {
        WIDTH: W, PADDING: P, ACCENT_H, HEADER_H,
        PLAYER_H, STATS_H, FOOTER_H, AVATAR_R, BADGE_R,
    } = RESULT_CARD;

    const Y = offsetY;

    ctx.textBaseline = 'alphabetic';

    // Background
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, Y, W, RESULT_CARD_H);

    // ── Orange accent bar ──────────────────────────────────────────────────────
    ctx.fillStyle = COLOR.accent;
    ctx.fillRect(0, Y, W, ACCENT_H);

    // ── Header ─────────────────────────────────────────────────────────────────
    const resHdrGrad = ctx.createLinearGradient(0, Y + ACCENT_H, 0, Y + ACCENT_H + HEADER_H);
    resHdrGrad.addColorStop(0, COLOR.headerBg);
    resHdrGrad.addColorStop(1, '#222222');
    ctx.fillStyle = resHdrGrad;
    ctx.fillRect(0, Y + ACCENT_H, W, HEADER_H);

    ctx.fillStyle = COLOR.text;
    ctx.font      = `bold 22px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText('MATCH RESULT', P, Y + ACCENT_H + 36);

    const metaParts = [competition, map].filter(Boolean);
    ctx.fillStyle = COLOR.subtext;
    ctx.font      = `14px ${FONT_FAMILY}`;
    ctx.fillText(metaParts.length ? metaParts.join('  ·  ') : 'CS2', P, Y + ACCENT_H + 62);

    // WIN / LOSE badge
    const isWin      = result === 1 || result === '1';
    const badgeLabel = isWin ? 'WIN' : 'LOSE';
    const badgeColor = isWin ? COLOR.positive : COLOR.negative;
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    const bw = ctx.measureText(badgeLabel).width + 24;
    const bh = 28;
    const bx = W - P - bw;
    const by = Y + ACCENT_H + HEADER_H / 2 - bh / 2;

    roundRect(ctx, bx, by, bw, bh, 5);
    ctx.fillStyle = badgeColor + '33';
    ctx.fill();
    roundRect(ctx, bx, by, bw, bh, 5);
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.fillStyle    = badgeColor;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeLabel, bx + bw / 2, by + bh / 2);
    ctx.textBaseline = 'alphabetic';

    // Score line below badge (e.g. "16 : 12") — shown when both scores are available
    if (teamScore != null && opponentScore != null) {
        ctx.fillStyle = badgeColor;
        ctx.font      = `bold 13px ${FONT_FAMILY}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${teamScore} : ${opponentScore}`, W - P, by + bh + 16);
    }

    ctx.fillStyle = COLOR.separator;
    ctx.fillRect(0, Y + ACCENT_H + HEADER_H - 1, W, 1);

    // ── Player row ─────────────────────────────────────────────────────────────
    const playerY    = Y + ACCENT_H + HEADER_H;
    const playerMidY = playerY + PLAYER_H / 2;
    const avatarCx   = P + AVATAR_R;

    if (avatar) {
        drawCircularAvatar(ctx, avatar, avatarCx, playerMidY, AVATAR_R);
    } else {
        drawAvatarPlaceholder(ctx, nickname?.[0], avatarCx, playerMidY, AVATAR_R);
    }

    const badgeCx  = avatarCx + AVATAR_R + 10 + BADGE_R;
    drawSkillBadge(ctx, skillLevel, badgeCx, playerMidY, BADGE_R);

    const nameX    = badgeCx + BADGE_R + 14;
    const maxNameW = W - nameX - P - 120;
    ctx.fillStyle = COLOR.text;
    ctx.font      = `bold 20px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(truncateText(ctx, nickname, maxNameW), nameX, playerMidY - 2);

    // ELO + delta (right side) — tight two-line block
    const eloStr = currentElo != null ? String(currentElo) : '—';
    ctx.textAlign = 'right';

    if (eloChange != null) {
        const sign       = eloChange >= 0 ? '+' : '';
        const deltaText  = `${sign}${eloChange} ELO`;
        const deltaColor = eloChange > 0 ? COLOR.positive : eloChange < 0 ? COLOR.negative : COLOR.subtext;

        ctx.fillStyle = COLOR.text;
        ctx.font      = `bold 22px ${FONT_FAMILY}`;
        ctx.fillText(eloStr, W - P, playerMidY - 8);

        ctx.fillStyle = deltaColor;
        ctx.font      = `bold 14px ${FONT_FAMILY}`;
        ctx.fillText(deltaText, W - P, playerMidY + 16);
    } else {
        ctx.fillStyle = COLOR.text;
        ctx.font      = `bold 22px ${FONT_FAMILY}`;
        ctx.fillText(`${eloStr} ELO`, W - P, playerMidY + 7);
    }

    // Separator
    ctx.fillStyle = COLOR.separator;
    ctx.fillRect(0, playerY + PLAYER_H - 1, W, 1);

    // ── Stats row ──────────────────────────────────────────────────────────────
    const statsY = playerY + PLAYER_H;
    ctx.fillStyle = COLOR.rowAlt;
    ctx.fillRect(0, statsY, W, STATS_H);

    const statCols = [
        { label: 'KILLS',   value: String(kills)               },
        { label: 'ASSISTS', value: String(assists)              },
        { label: 'K/D',     value: parseFloat(kd).toFixed(2)   },
        { label: 'ADR',     value: parseFloat(adr).toFixed(1)  },
        { label: 'HS%',     value: `${hsPercent}%`             },
    ];

    const colW = (W - 2 * P) / statCols.length;
    statCols.forEach((col, i) => {
        const colCx = P + colW * i + colW / 2;

        ctx.fillStyle = COLOR.subtext;
        ctx.font      = `12px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.fillText(col.label, colCx, statsY + 24);

        ctx.fillStyle = COLOR.text;
        ctx.font      = `bold 22px ${FONT_FAMILY}`;
        ctx.fillText(col.value, colCx, statsY + 56);
    });

    // ── Footer ─────────────────────────────────────────────────────────────────
    const footerY = Y + RESULT_CARD_H - FOOTER_H;
    ctx.fillStyle = COLOR.headerBg;
    ctx.fillRect(0, footerY, W, FOOTER_H);
    ctx.fillStyle = COLOR.subtext;
    ctx.font      = `12px ${FONT_FAMILY}`;
    ctx.textAlign = 'right';
    ctx.fillText('FACEIT Stats Bot', W - P, footerY + FOOTER_H / 2 + 4);
}

/**
 * Generates a single-player match result card as a PNG buffer.
 * Public API — returns Buffer; avatar is loaded internally.
 * @param {{
 *   nickname:      string,
 *   avatar_url:    string|null,
 *   skillLevel:    number|null,
 *   currentElo:    number|null,
 *   eloChange:     number|null,
 *   kills:         number,
 *   deaths:        number,
 *   assists:       number,
 *   kd:            number,
 *   adr:           number,
 *   hsPercent:     number,
 *   result:        number,        // 1 = win, 0 = loss
 *   competition:   string|null,
 *   map:           string|null,
 *   teamScore:     number|null,   // player's team final score (e.g. 16)
 *   opponentScore: number|null,   // opponent team final score (e.g. 12)
 * }} data
 * @returns {Promise<Buffer>}
 */
async function generateMatchResultImage(data) {
    const { WIDTH: W } = RESULT_CARD;
    const avatar = await _loadAvatar(data.avatar_url);
    const canvas = createCanvas(W, RESULT_CARD_H);
    const ctx    = canvas.getContext('2d');
    _drawMatchResultCard(ctx, data, 0, avatar);
    return canvas.toBuffer('image/png');
}

/**
 * Generates one vertical image stacking multiple match result cards (one per player).
 * Eliminates intermediate PNG encode/decode — all cards are drawn directly onto a
 * single canvas; only one final toBuffer() call is made.
 * @param {Array<object>} playersData
 * @returns {Promise<Buffer>}
 */
async function generateMatchResultsSummaryImage(playersData) {
    if (!Array.isArray(playersData) || playersData.length === 0) {
        throw new Error('playersData is required');
    }

    const { WIDTH: W } = RESULT_CARD;
    const GAP         = 10;
    const totalHeight = RESULT_CARD_H * playersData.length + GAP * (playersData.length - 1);

    // Load all avatars in parallel — no intermediate PNG encode/decode
    const avatars = await Promise.all(playersData.map(d => _loadAvatar(d.avatar_url)));

    const canvas = createCanvas(W, totalHeight);
    const ctx    = canvas.getContext('2d');

    // Page-level background fills gaps between stacked cards (#121212 = --bg from web app)
    ctx.fillStyle = COLOR.pageBg;
    ctx.fillRect(0, 0, W, totalHeight);

    for (let i = 0; i < playersData.length; i++) {
        _drawMatchResultCard(ctx, playersData[i], i * (RESULT_CARD_H + GAP), avatars[i]);
    }

    return canvas.toBuffer('image/png');
}

// ── Activity image (for /activity) ────────────────────────────────────────────

const ACT_W        = 720;
const ACT_PAD      = 28;
const ACT_ACCENT_H = 5;
const ACT_HEADER_H = 130;
const ACT_ROW_H    = 68;
const ACT_FOOTER_H = 42;
const ACT_AVATAR_R = 20;

const ACT_COLUMNS = [
    { label: 'PLAYER',  w: 240, align: 'left'  },
    { label: 'MATCHES', w: 80,  align: 'right' },
    { label: 'WINS',    w: 80,  align: 'right' },
    { label: 'WIN%',    w: 80,  align: 'right' },
    { label: 'TIME',    w: 192, align: 'right' },
];

const ACT_COL_X = ACT_COLUMNS.map((_, i) =>
    ACT_COLUMNS.slice(0, i).reduce((sum, c) => sum + c.w, ACT_PAD)
);

const ACT_AVATAR_CX  = ACT_PAD + ACT_AVATAR_R;
const ACT_NAME_X     = ACT_PAD + ACT_AVATAR_R * 2 + 10;
const ACT_NAME_MAX_W = ACT_COLUMNS[0].w - ACT_AVATAR_R * 2 - 10 - CELL_PAD;

/**
 * Format a duration in seconds to a human-readable string.
 * Uses Latin abbreviations (h / min) so that the bundled Inter WOFF2 font
 * (Latin-only subset) renders correctly without missing-glyph boxes.
 * Examples: 3900 → "1h 5min"   2700 → "45min"
 * @param {number} totalSec
 * @returns {string}
 */
function formatDuration(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
}

/**
 * Draw a right-aligned stat cell in the activity table.
 */
function drawActCell(ctx, text, colIndex, y, color = COLOR.text) {
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.fillText(text, ACT_COL_X[colIndex] + ACT_COLUMNS[colIndex].w - CELL_PAD, y);
}

/**
 * Generates a FACEIT-styled activity card as a PNG buffer.
 * @param {Array<{
 *   nickname: string,
 *   matchCount: number,
 *   wins: number,
 *   losses: number,
 *   winRate: number,
 *   totalDurationSec: number,
 *   avgDurationSec: number,
 * }>} activityData  Sorted by matchCount descending
 * @param {number} days  Period in days
 * @returns {Promise<Buffer>}
 */
async function generateActivityImage(activityData, days) {
    const rowCount = activityData.length;
    const HEIGHT   = ACT_ACCENT_H + ACT_HEADER_H + Math.max(rowCount, 1) * ACT_ROW_H + ACT_FOOTER_H;

    const canvas = createCanvas(ACT_W, HEIGHT);
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, ACT_W, HEIGHT);

    // ── Header gradient + accent bar ──────────────────────────────────────────
    const hdrGrad = ctx.createLinearGradient(0, 0, 0, ACT_ACCENT_H + ACT_HEADER_H);
    hdrGrad.addColorStop(0, COLOR.headerBg);
    hdrGrad.addColorStop(1, '#222222');
    ctx.fillStyle = hdrGrad;
    ctx.fillRect(0, 0, ACT_W, ACT_ACCENT_H + ACT_HEADER_H);

    ctx.fillStyle = COLOR.accent;
    ctx.fillRect(0, 0, ACT_W, ACT_ACCENT_H);

    // Title + subtitle
    ctx.fillStyle    = COLOR.text;
    ctx.font         = FONT.title;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('FACEIT ACTIVITY', ACT_PAD, ACT_ACCENT_H + 52);

    ctx.fillStyle = COLOR.subtext;
    ctx.font      = FONT.subtitle;
    ctx.fillText(`Last ${days} days · CS2`, ACT_PAD, ACT_ACCENT_H + 86);

    // Column labels
    const colLabelY = ACT_ACCENT_H + ACT_HEADER_H - 14;
    ctx.font = FONT.colLabel;
    ACT_COLUMNS.forEach((col, i) => {
        ctx.fillStyle = COLOR.subtext;
        if (i === 0) {
            ctx.textAlign = 'left';
            ctx.fillText(col.label, ACT_PAD, colLabelY);
        } else {
            ctx.textAlign = 'right';
            ctx.fillText(col.label, ACT_COL_X[i] + col.w - CELL_PAD, colLabelY);
        }
    });

    ctx.fillStyle = COLOR.separator;
    ctx.fillRect(0, ACT_ACCENT_H + ACT_HEADER_H - 1, ACT_W, 1);

    // ── Empty state ───────────────────────────────────────────────────────────
    if (rowCount === 0) {
        ctx.fillStyle    = COLOR.subtext;
        ctx.font         = `22px ${FONT_FAMILY}`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No data', ACT_W / 2, ACT_ACCENT_H + ACT_HEADER_H + ACT_ROW_H / 2);
    }

    // ── Rows ──────────────────────────────────────────────────────────────────
    activityData.forEach((player, i) => {
        const rowY  = ACT_ACCENT_H + ACT_HEADER_H + i * ACT_ROW_H;
        const midY  = rowY + ACT_ROW_H / 2;
        const textY = midY + 7;

        ctx.fillStyle = i % 2 === 0 ? COLOR.bg : COLOR.rowAlt;
        ctx.fillRect(0, rowY, ACT_W, ACT_ROW_H);

        ctx.fillStyle = COLOR.separator;
        ctx.fillRect(0, rowY + ACT_ROW_H - 1, ACT_W, 1);

        // Avatar placeholder
        drawAvatarPlaceholder(ctx, player.nickname[0], ACT_AVATAR_CX, midY, ACT_AVATAR_R);

        // Nickname
        ctx.fillStyle    = COLOR.text;
        ctx.font         = `bold 20px ${FONT_FAMILY}`;
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(truncateText(ctx, player.nickname, ACT_NAME_MAX_W), ACT_NAME_X, textY);

        ctx.font = `20px ${FONT_FAMILY}`;

        // Matches
        drawActCell(ctx, String(player.matchCount), 1, textY);

        // Wins (green)
        const winsColor = player.wins > 0 ? COLOR.positive : COLOR.subtext;
        drawActCell(ctx, String(player.wins), 2, textY, winsColor);

        // Win%
        const winRateColor = player.winRate >= 50 ? COLOR.positive : COLOR.negative;
        drawActCell(ctx, `${player.winRate}%`, 3, textY, winRateColor);

        // Time
        const timeText = player.totalDurationSec > 0 ? formatDuration(player.totalDurationSec) : '—';
        drawActCell(ctx, timeText, 4, textY, COLOR.subtext);
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = HEIGHT - ACT_FOOTER_H;
    ctx.fillStyle = COLOR.headerBg;
    ctx.fillRect(0, footerY, ACT_W, ACT_FOOTER_H);
    ctx.fillStyle    = COLOR.subtext;
    ctx.font         = `18px ${FONT_FAMILY}`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('FACEIT Stats Bot', ACT_W - ACT_PAD, footerY + ACT_FOOTER_H / 2 + 6);

    return canvas.toBuffer('image/png');
}

module.exports = {
    generateStatsImage,
    generateMatchImage,
    generateMatchResultImage,
    generateMatchResultsSummaryImage,
    generatePlayerCard,
    generatePlayersListImage,
    generateActivityImage,
};
