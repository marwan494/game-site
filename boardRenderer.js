'use strict';

const path = require('path');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const { drawPiece } = require('./pieces');
const { loadAvatarImage } = require('./avatarCache');

// Bundled font (Noto Sans Arabic, SIL OFL license) — guarantees correct
// Arabic + Latin rendering regardless of what fonts the host machine has.
GlobalFonts.registerFromPath(
  path.join(__dirname, '..', '..', 'assets', 'fonts', 'NotoSansArabic-Variable.ttf'),
  'NotoArabic'
);

// The bundled font has no color-emoji glyphs, and we can't assume the host
// machine has one either — so any emoji baked into the *canvas* (as
// opposed to Discord embed text, which Discord renders client-side and is
// always safe) shows up as a tofu box. This can come from status text we
// generate ourselves, or from a player's Discord display name, which can
// freely contain emoji. Strip it right at the render boundary so nothing
// drawn on the board can ever produce a broken glyph.
const EMOJI_PATTERN =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;
function sanitizeForCanvas(str) {
  return String(str || '')
    .replace(EMOJI_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const SQUARE = 84;
const BOARD_PX = SQUARE * 8;
const PAD = 46; // coordinate label gutter
const HEADER = 96;
const FOOTER = 96;
const FRAME = 14; // obsidian bezel around the whole plaque
const MARGIN = 20; // transparent margin for the drop shadow
const BOARD_ASSET_DIR = path.join(__dirname, '..', '..', 'assets', 'board');

let textureCachePromise = null;
async function loadBoardTextures() {
  if (!textureCachePromise) {
    textureCachePromise = Promise.all([
      loadImage(path.join(BOARD_ASSET_DIR, 'ivory-squares.png')),
      loadImage(path.join(BOARD_ASSET_DIR, 'ebony-squares.png')),
      loadImage(path.join(BOARD_ASSET_DIR, 'obsidian-frame.png')),
    ]).then(([ivory, ebony, frame]) => ({ ivory, ebony, frame })).catch((err) => {
      textureCachePromise = null;
      throw err;
    });
  }
  return textureCachePromise;
}
const INNER_W = BOARD_PX + PAD * 2;
const INNER_H = BOARD_PX + PAD * 2 + HEADER + FOOTER;
const WIDTH = INNER_W + FRAME * 2 + MARGIN * 2;
const HEIGHT = INNER_H + FRAME * 2 + MARGIN * 2;
const OX = MARGIN + FRAME; // inner panel origin
const OY = MARGIN + FRAME;

const THEME = {
  light: '#E7E7E3',
  dark: '#2B2B2B',
  obsidianTop: '#111214',
  obsidianMid: '#08090A',
  obsidianBottom: '#030304',
  inlay: 'rgba(245, 245, 240, 0.30)',
  panel: '#0D0D0D',
  panelAlt: '#141414',
  text: '#F7F7F2',
  subtext: '#A9A9A3',
  accentGold: '#D8D8D2',
  lastMove: 'rgba(255,255,255,0.18)',
  selected: 'rgba(255,255,255,0.22)',
  legalDot: 'rgba(255,255,255,0.40)',
  legalCapture: 'rgba(240,240,235,0.94)',
  check: 'rgba(220,55,55,0.72)',
  previewFrom: 'rgba(235,235,230,0.22)',
  previewTo: 'rgba(255,255,255,0.36)',
  arrow: 'rgba(250,250,246,0.94)',
  arrowCapture: 'rgba(220,220,214,0.96)',
};

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function fileIndex(square) {
  return square.charCodeAt(0) - 97; // a-h -> 0-7
}
function rankIndex(square) {
  return 8 - parseInt(square[1], 10); // 8-1 -> 0-7
}

function squareToXY(square, flipped) {
  let f = fileIndex(square);
  let r = rankIndex(square);
  if (flipped) {
    f = 7 - f;
    r = 7 - r;
  }
  return { x: OX + PAD + f * SQUARE, y: OY + HEADER + PAD + r * SQUARE };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Cheap procedural frame-texture: a handful of wavy, low-alpha strokes
 *  confined to the given rect — enough to read as "textured obsidian" at
 *  Discord embed size without needing an external texture asset. */
function drawFrameGrain(ctx, x, y, w, h, seed = 1) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 10);
  ctx.clip();
  ctx.globalAlpha = 0.075;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.0;
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const lines = Math.max(6, Math.floor((w + h) / 40));
  for (let i = 0; i < lines; i++) {
    const startY = y - h * 0.2 + rand() * h * 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 10, startY);
    const midY = startY + (rand() - 0.5) * 18;
    const midX = x + w * (0.3 + rand() * 0.4);
    ctx.quadraticCurveTo(midX, midY, x + w + 10, startY + (rand() - 0.5) * 14);
    ctx.stroke();
  }
  ctx.restore();
}

function materialDiff(board) {
  let white = 0;
  let black = 0;
  const captured = { w: [], b: [] };
  const onBoard = { w: {}, b: {} };
  for (const row of board) {
    for (const cell of row) {
      if (!cell) continue;
      onBoard[cell.color][cell.type] = (onBoard[cell.color][cell.type] || 0) + 1;
    }
  }
  const full = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  for (const type of Object.keys(full)) {
    const missingWhite = full[type] - (onBoard.w[type] || 0);
    const missingBlack = full[type] - (onBoard.b[type] || 0);
    // black captured `missingWhite` white pieces; those trophies are white-colored
    for (let i = 0; i < missingWhite; i++) captured.b.push({ type, color: 'w' });
    for (let i = 0; i < missingBlack; i++) captured.w.push({ type, color: 'b' });
    white += (onBoard.w[type] || 0) * PIECE_VALUE[type];
    black += (onBoard.b[type] || 0) * PIECE_VALUE[type];
  }
  return { captured, diff: white - black };
}

/**
 * @param {import('chess.js').Chess} chess
 * @param {object} opts
 *   flipped: boolean
 *   selected: square string|null
 *   legalTargets: {square, capture}[]
 *   lastMove: {from, to}|null
 *   previewMove: {from, to, capture}|null  — draws a distinct silver highlight
 *     + arrow overlay for a move being *considered* but not yet confirmed
 *   whiteName, blackName: string
 *   whiteSubLabel, blackSubLabel: string — shown under the name (bot ELO
 *     for AI sides, "@username" for human sides)
 *   whiteAvatarURL, blackAvatarURL: string|null — Discord avatar to draw
 *     next to the name; null/AI sides get a generated placeholder instead
 *   statusText: string  (e.g. "دور الأبيض" / "كش ملك!" / "انتهت اللعبة")
 * @returns {Promise<Buffer>}
 */
async function renderGameImage(chess, opts = {}) {
  const {
    flipped = false,
    selected = null,
    legalTargets = [],
    lastMove = null,
    previewMove = null,
    whiteName: whiteNameRaw = 'White',
    blackName: blackNameRaw = 'Black',
    whiteSubLabel = '',
    blackSubLabel = '',
    whiteAvatarURL = null,
    blackAvatarURL = null,
    whiteIsAI = false,
    blackIsAI = false,
    statusText: statusTextRaw = '',
    whiteIsTurn = chess.turn() === 'w',
  } = opts;
  const whiteName = sanitizeForCanvas(whiteNameRaw) || 'White';
  const blackName = sanitizeForCanvas(blackNameRaw) || 'Black';
  const statusText = sanitizeForCanvas(statusTextRaw);

  // Kick avatar downloads off early so they resolve in parallel with all
  // the synchronous canvas setup below instead of blocking sequentially.
  const [whiteAvatarImg, blackAvatarImg] = await Promise.all([
    loadAvatarImage(whiteAvatarURL),
    loadAvatarImage(blackAvatarURL),
  ]);

  let boardTextures = null;
  try {
    boardTextures = await loadBoardTextures();
  } catch (err) {
    // Keep rendering with the procedural fallback if an asset is missing.
    console.warn('Board texture load failed; using procedural fallback:', err.message || err);
  }

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // soft drop shadow so the plaque "floats" off Discord's dark background
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#000000';
  roundRect(ctx, MARGIN, MARGIN, INNER_W + FRAME * 2, INNER_H + FRAME * 2, 20);
  ctx.fill();
  ctx.restore();

  // Obsidian bezel: gradient + bundled micro-texture for a photographic finish.
  const frameGrad = ctx.createLinearGradient(0, MARGIN, 0, HEIGHT - MARGIN);
  frameGrad.addColorStop(0, THEME.obsidianTop);
  frameGrad.addColorStop(0.5, THEME.obsidianMid);
  frameGrad.addColorStop(1, THEME.obsidianBottom);
  ctx.fillStyle = frameGrad;
  roundRect(ctx, MARGIN, MARGIN, INNER_W + FRAME * 2, INNER_H + FRAME * 2, 20);
  ctx.fill();
  if (boardTextures?.frame) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(boardTextures.frame, MARGIN, MARGIN, INNER_W + FRAME * 2, INNER_H + FRAME * 2);
    ctx.restore();
  } else {
    drawFrameGrain(ctx, MARGIN, MARGIN, INNER_W + FRAME * 2, INNER_H + FRAME * 2, 7);
  }

  // thin silver inlay line tracing the inner edge of the obsidian bezel
  ctx.save();
  ctx.strokeStyle = THEME.inlay;
  ctx.lineWidth = 1.6;
  roundRect(ctx, OX - 4, OY - 4, INNER_W + 8, INNER_H + 8, 10);
  ctx.stroke();
  ctx.restore();

  // header panel (top player = black unless flipped)
  const topName = flipped ? whiteName : blackName;
  const topSubLabel = flipped ? whiteSubLabel : blackSubLabel;
  const topAvatar = flipped ? whiteAvatarImg : blackAvatarImg;
  const topIsAI = flipped ? whiteIsAI : blackIsAI;
  const bottomName = flipped ? blackName : whiteName;
  const bottomSubLabel = flipped ? blackSubLabel : whiteSubLabel;
  const bottomAvatar = flipped ? blackAvatarImg : whiteAvatarImg;
  const bottomIsAI = flipped ? blackIsAI : whiteIsAI;
  const topColor = flipped ? 'w' : 'b';
  const bottomColor = flipped ? 'b' : 'w';

  const board = chess.board();
  const { captured, diff } = materialDiff(board);
  const topCaptured = flipped ? captured.w : captured.b;
  const bottomCaptured = flipped ? captured.b : captured.w;
  const topDiff = flipped ? Math.max(0, diff) : Math.max(0, -diff);
  const bottomDiff = flipped ? Math.max(0, -diff) : Math.max(0, diff);

  const topBar = drawPlayerBar(ctx, OX, OY, topName, topSubLabel, topColor, topCaptured, topDiff, topAvatar, topIsAI);
  drawPlayerBar(
    ctx,
    OX,
    OY + INNER_H - FOOTER,
    bottomName,
    bottomSubLabel,
    bottomColor,
    bottomCaptured,
    bottomDiff,
    bottomAvatar,
    bottomIsAI
  );
  // active-turn indicator dot (drawn precisely below)
  const activeIsTop = flipped ? whiteIsTurn : !whiteIsTurn;
  drawTurnDot(ctx, activeIsTop ? OY + 28 : OY + INNER_H - FOOTER + 28);

  // board background
  ctx.fillStyle = THEME.panel;
  ctx.fillRect(OX, OY + HEADER, INNER_W, BOARD_PX + PAD * 2);

  // Squares: 2×2 variation sheets prevent the obvious repeated-tile look.
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const isLight = (r + f) % 2 === 0;
      const x = OX + PAD + f * SQUARE;
      const y = OY + HEADER + PAD + r * SQUARE;
      const texture = isLight ? boardTextures?.ivory : boardTextures?.ebony;
      if (texture) {
        const variant = (f + r * 3) % 4;
        const sx = (variant % 2) * 512;
        const sy = Math.floor(variant / 2) * 512;
        ctx.drawImage(texture, sx, sy, 512, 512, x, y, SQUARE, SQUARE);
      } else {
        ctx.fillStyle = isLight ? THEME.light : THEME.dark;
        ctx.fillRect(x, y, SQUARE, SQUARE);
      }
      // Glass-like local sheen and edge shading keeps the grid readable even
      // when Discord resizes the PNG down to a compact message width.
      const shade = ctx.createLinearGradient(x, y, x + SQUARE, y + SQUARE);
      shade.addColorStop(0, 'rgba(255,255,255,0.08)');
      shade.addColorStop(0.48, 'rgba(255,255,255,0)');
      shade.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, SQUARE, SQUARE);
    }
  }
  // subtle inner bevel shadow around the 8x8 grid so it reads as inset
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.48)';
  ctx.lineWidth = 4;
  ctx.strokeRect(OX + PAD - 1.5, OY + HEADER + PAD - 1.5, BOARD_PX + 3, BOARD_PX + 3);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(246,246,240,0.18)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(OX + PAD + 0.6, OY + HEADER + PAD + 0.6, BOARD_PX - 1.2, BOARD_PX - 1.2);
  ctx.restore();

  // last move highlight
  if (lastMove) {
    for (const sq of [lastMove.from, lastMove.to]) {
      const { x, y } = squareToXY(sq, flipped);
      ctx.fillStyle = THEME.lastMove;
      ctx.fillRect(x, y, SQUARE, SQUARE);
    }
  }

  // move-under-consideration highlight (live preview, before confirmation)
  if (previewMove) {
    const from = squareToXY(previewMove.from, flipped);
    ctx.fillStyle = THEME.previewFrom;
    ctx.fillRect(from.x, from.y, SQUARE, SQUARE);
    const to = squareToXY(previewMove.to, flipped);
    ctx.fillStyle = THEME.previewTo;
    ctx.fillRect(to.x, to.y, SQUARE, SQUARE);
  }

  // king-in-check highlight
  if (chess.inCheck()) {
    const kingSquare = findKing(chess, chess.turn());
    if (kingSquare) {
      const { x, y } = squareToXY(kingSquare, flipped);
      const g = ctx.createRadialGradient(
        x + SQUARE / 2,
        y + SQUARE / 2,
        4,
        x + SQUARE / 2,
        y + SQUARE / 2,
        SQUARE / 1.3
      );
      g.addColorStop(0, THEME.check);
      g.addColorStop(1, 'rgba(220,40,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, SQUARE, SQUARE);
    }
  }

  // selected square
  if (selected) {
    const { x, y } = squareToXY(selected, flipped);
    ctx.fillStyle = THEME.selected;
    ctx.fillRect(x, y, SQUARE, SQUARE);
  }

  // coordinate labels
  ctx.font = '600 20px NotoArabic';
  ctx.fillStyle = THEME.subtext;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let f = 0; f < 8; f++) {
    const file = flipped ? String.fromCharCode(104 - f) : String.fromCharCode(97 + f);
    ctx.fillText(file, OX + PAD + f * SQUARE + SQUARE / 2, OY + HEADER + PAD + BOARD_PX + PAD / 2);
  }
  for (let r = 0; r < 8; r++) {
    const rank = flipped ? r + 1 : 8 - r;
    ctx.fillText(String(rank), OX + PAD / 2, OY + HEADER + PAD + r * SQUARE + SQUARE / 2);
  }

  // pieces
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (!cell) continue;
      const square = String.fromCharCode(97 + f) + (8 - r);
      const { x, y } = squareToXY(square, flipped);
      drawPiece(ctx, cell.type, cell.color, x + SQUARE / 2, y + SQUARE / 2, SQUARE * 0.86);
    }
  }

  // legal move indicators (drawn above pieces for captures, below for empty)
  for (const t of legalTargets) {
    const { x, y } = squareToXY(t.square, flipped);
    ctx.beginPath();
    if (t.capture) {
      ctx.lineWidth = 6;
      ctx.strokeStyle = THEME.legalCapture;
      ctx.arc(x + SQUARE / 2, y + SQUARE / 2, SQUARE / 2 - 5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = THEME.legalDot;
      ctx.arc(x + SQUARE / 2, y + SQUARE / 2, SQUARE * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // preview arrow (drawn above pieces, lichess/chess.com style)
  if (previewMove) {
    const from = squareToXY(previewMove.from, flipped);
    const to = squareToXY(previewMove.to, flipped);
    drawArrow(
      ctx,
      from.x + SQUARE / 2,
      from.y + SQUARE / 2,
      to.x + SQUARE / 2,
      to.y + SQUARE / 2,
      previewMove.capture ? THEME.arrowCapture : THEME.arrow
    );
  }

  // premium live badges: mode, turn and move count. They stay inside the
  // header so the board reads like a dedicated chess client, not a flat PNG.
  drawLiveBadge(ctx, OX + INNER_W - 134, OY + HEADER / 2, 'LIVE');
  drawMoveCounter(ctx, chess.history().length);

  // status banner — placed in the space to the right of the top player's
  // name (never centered blindly across the full width), so a long
  // status sentence ("إلى أين تريد تحريك القطعة من e2؟") can never
  // overlap a long display name / bot label sitting on the same row.
  if (statusText) {
    ctx.font = '700 24px NotoArabic';
    ctx.fillStyle = THEME.accentGold;
    const leftBound = topBar.nameEndX + 28;
    const rightBound = OX + INNER_W - 180; // reserve space for the turn dot + capture trophies
    const availWidth = Math.max(70, rightBound - leftBound);
    const truncatedStatus = truncateToWidth(ctx, statusText, availWidth);
    ctx.textAlign = 'center';
    ctx.fillText(truncatedStatus, leftBound + availWidth / 2, OY + HEADER / 2);
  }

  // discreet corner credit — small, professional, never overlaps content
  drawCredit(ctx);

  return canvas.toBuffer('image/png');
}

/**
 * Draws a modern chess-client style move arrow. Knight-shaped moves get a
 * single bend at the midpoint so the arrow reads as an "L" instead of
 * cutting diagonally through an unrelated square.
 */
function drawArrow(ctx, x1, y1, x2, y2, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fileDelta = Math.round(dx / SQUARE);
  const rankDelta = Math.round(dy / SQUARE);
  const isKnightShape =
    (Math.abs(fileDelta) === 1 && Math.abs(rankDelta) === 2) ||
    (Math.abs(fileDelta) === 2 && Math.abs(rankDelta) === 1);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let bendX = null;
  let bendY = null;
  if (isKnightShape) {
    // Bend along whichever axis has the longer leg first (matches the
    // natural "long side then short side" feel of a knight hop).
    if (Math.abs(fileDelta) === 1) {
      bendX = x1;
      bendY = y2;
    } else {
      bendX = x2;
      bendY = y1;
    }
  }

  // Work out the direction of the final leg (the one carrying the head).
  const legStartX = bendX ?? x1;
  const legStartY = bendY ?? y1;
  const finalDx = x2 - legStartX;
  const finalDy = y2 - legStartY;
  const finalLen = Math.hypot(finalDx, finalDy) || 1;
  const ux = finalDx / finalLen;
  const uy = finalDy / finalLen;

  const shrink = SQUARE * 0.34; // stop short of the square's dead center
  const tipX = x2 - ux * shrink;
  const tipY = y2 - uy * shrink;

  const headLen = 24;
  const headWidth = 15;
  const shaftEndX = tipX - ux * headLen;
  const shaftEndY = tipY - uy * headLen;
  const perpX = -uy;
  const perpY = ux;

  // shaft
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  if (bendX !== null) ctx.lineTo(bendX, bendY);
  ctx.lineTo(shaftEndX, shaftEndY);
  ctx.stroke();

  // arrowhead (triangle pointing at tipX/tipY)
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(shaftEndX + perpX * headWidth, shaftEndY + perpY * headWidth);
  ctx.lineTo(shaftEndX - perpX * headWidth, shaftEndY - perpY * headWidth);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTurnDot(ctx, y) {
  ctx.save();
  ctx.shadowColor = 'rgba(217,178,92,0.9)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.fillStyle = THEME.accentGold;
  ctx.arc(OX + INNER_W - 26, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

/** Circular avatar (or generated bot placeholder) with a small side-color
 *  indicator dot, drawn at the left edge of a player bar. */
function drawAvatar(ctx, cx, cy, radius, image, sideColor, isAI) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.save();
  ctx.clip();
  if (image) {
    ctx.drawImage(image, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    const g = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
    g.addColorStop(0, '#2c3626');
    g.addColorStop(1, '#161c11');
    ctx.fillStyle = g;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    if (isAI) {
      // A miniature knight (reusing the same premium vector piece art)
      // reads instantly as "engine opponent" instead of a generic icon.
      drawPiece(ctx, 'n', sideColor, cx, cy + radius * 0.06, radius * 1.62);
    }
  }
  ctx.restore();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = THEME.accentGold;
  ctx.stroke();
  ctx.restore();

  // side-color indicator dot (which physical chess color this player has)
  const dotCx = cx + radius * 0.74;
  const dotCy = cy + radius * 0.74;
  const dotR = radius * 0.36;
  ctx.save();
  ctx.beginPath();
  ctx.arc(dotCx, dotCy, dotR + 2, 0, Math.PI * 2);
  ctx.fillStyle = THEME.panelAlt;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dotCx, dotCy, dotR, 0, Math.PI * 2);
  ctx.fillStyle = sideColor === 'w' ? '#f2ecdd' : '#242220';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = THEME.accentGold;
  ctx.stroke();
  ctx.restore();
}

function drawPlayerBar(ctx, x, y, name, subLabel, sideColor, capturedList, diff, avatarImage, isAI) {
  const barH = y === OY ? HEADER : FOOTER;
  ctx.fillStyle = THEME.panelAlt;
  ctx.fillRect(x, y, INNER_W, barH);
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (barH === HEADER) {
    ctx.moveTo(x, y + barH);
    ctx.lineTo(x + INNER_W, y + barH);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + INNER_W, y);
  }
  ctx.stroke();
  ctx.restore();

  const avatarR = 27;
  const avatarCx = x + 40;
  const avatarCy = y + barH / 2;
  drawAvatar(ctx, avatarCx, avatarCy, avatarR, avatarImage, sideColor, isAI);

  const textX = avatarCx + avatarR + 16;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '700 25px NotoArabic';
  ctx.fillStyle = THEME.text;
  // Cap the name's width to roughly 40% of the bar so a long display
  // name/bot label can never grow wide enough to collide with the
  // centered status banner text sitting above the board — a real
  // overlap risk once avatars pushed the name's start position inward.
  const nameMaxWidth = Math.min(INNER_W - (textX - x) - 210, INNER_W * 0.4);
  const truncatedName = truncateToWidth(ctx, name, nameMaxWidth);
  ctx.fillText(truncatedName, textX, y + barH / 2 - 13);
  const nameEndX = textX + ctx.measureText(truncatedName).width;

  ctx.font = '500 16px NotoArabic';
  ctx.fillStyle = THEME.subtext;
  ctx.fillText(truncateToWidth(ctx, subLabel || '', nameMaxWidth), textX, y + barH / 2 + 15);

  // captured pieces row — rendered with the real vector pieces (miniature),
  // not a plain unicode glyph, so trophies match the board's art style.
  const trophyCy = y + barH / 2;
  let cx = x + INNER_W - 24;
  const order = { q: 0, r: 1, b: 2, n: 3, p: 4 };
  const sorted = [...capturedList].sort((a, b) => order[a.type] - order[b.type]);
  const iconSize = 26;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const item = sorted[i];
    drawPiece(ctx, item.type, item.color, cx - iconSize / 2, trophyCy, iconSize);
    cx -= iconSize * 0.62;
  }
  if (diff > 0) {
    ctx.textAlign = 'right';
    ctx.font = '600 15px NotoArabic';
    ctx.fillStyle = THEME.accentGold;
    ctx.fillText(`+${diff}`, cx - 4, trophyCy);
    ctx.textAlign = 'left';
  }

  return { nameEndX };
}

/** Small, unobtrusive brand credit in the bottom-right corner of the frame. */
function drawCredit(ctx) {
  ctx.save();
  ctx.font = '700 12px NotoArabic';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(247,247,242,0.68)';
  ctx.fillText('Powered By TC Team — 7amo', WIDTH - MARGIN - 12, HEIGHT - MARGIN - 8);
  ctx.restore();
}

function drawLiveBadge(ctx, cx, cy, label) {
  ctx.save();
  const w = 66, h = 28, x = cx - w / 2, y = cy - h / 2;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#F2F2ED');
  g.addColorStop(1, '#BDBDB7');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.fillStyle = '#111111';
  ctx.font = '800 11px NotoArabic';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 1);
  ctx.restore();
}

function drawMoveCounter(ctx, plies) {
  const moveNo = Math.floor(plies / 2) + 1;
  ctx.save();
  ctx.fillStyle = 'rgba(247,247,242,0.72)';
  ctx.font = '600 15px NotoArabic';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`MOVE ${moveNo}`, OX + INNER_W - 18, OY + HEADER / 2 + 25);
  ctx.restore();
}

function findKing(chess, color) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (cell && cell.type === 'k' && cell.color === color) {
        return String.fromCharCode(97 + f) + (8 - r);
      }
    }
  }
  return null;
}

module.exports = { renderGameImage, WIDTH, HEIGHT };
