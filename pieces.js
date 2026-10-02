'use strict';

/**
 * Professional, hand-built vector chess piece renderer — Staunton-inspired
 * silhouettes with real carved-material shading (gradients, rim light,
 * ambient occlusion), drawn from scratch with canvas path primitives on a
 * normalized 0..100 x 0..100 grid, then scaled to the target square size.
 * No external fonts, no external images, no third-party artwork —
 * 100% original vector work, tuned for a premium, realistic look.
 */

// ---------------------------------------------------------------------------
// Material palettes — ivory (white side) and ebony (black side), each with a
// light→dark gradient plus a soft rim highlight to fake carved-wood volume.
// ---------------------------------------------------------------------------
const MATERIAL = {
  w: {
    top: '#fffefa',
    mid: '#e9e4d7',
    bottom: '#b9b5aa',
    stroke: '#54534f',
    rim: 'rgba(255,255,255,0.95)',
    accent: '#d9d9d4',
    detail: 'rgba(72,72,68,0.50)',
    shadow: 'rgba(60,60,58,0.42)',
    spec: 'rgba(255,255,255,0.72)',
  },
  b: {
    top: '#515154',
    mid: '#202124',
    bottom: '#050506',
    stroke: '#000000',
    rim: 'rgba(255,255,255,0.20)',
    accent: '#dadad5',
    detail: 'rgba(214,214,208,0.30)',
    shadow: 'rgba(0,0,0,0.62)',
    spec: 'rgba(255,255,255,0.22)',
  },
};

function bodyGradient(ctx, mat, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, mat.top);
  g.addColorStop(0.26, mat.mid);
  g.addColorStop(0.52, mat.top);
  g.addColorStop(0.78, mat.mid);
  g.addColorStop(1, mat.bottom);
  return g;
}

function style(ctx, color, y0 = 0, y1 = 100) {
  const mat = MATERIAL[color];
  ctx.fillStyle = bodyGradient(ctx, mat, y0, y1);
  ctx.strokeStyle = mat.stroke;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return mat;
}

function volumeShading(ctx, mat) {
  ctx.save();
  const sheen = ctx.createLinearGradient(20, 0, 78, 0);
  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.34, mat.spec);
  sheen.addColorStop(0.48, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.70, 'rgba(0,0,0,0)');
  ctx.fillStyle = sheen;
  ctx.globalCompositeOperation = 'screen';
  ctx.fillRect(18, 8, 64, 78);
  ctx.restore();
}

/** A thin, soft highlight stroke traced just inside the left edge of a
 *  path — the cheap trick that sells "polished/carved" over "flat cartoon". */
function rimLight(ctx, mat, pathFn, widthFactor = 0.55) {
  ctx.save();
  ctx.strokeStyle = mat.rim;
  ctx.lineWidth = 2.6 * widthFactor;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.9;
  pathFn();
  ctx.stroke();
  ctx.restore();
}

/** Turned wooden base: a rounded foot disc + a stepped collar above it,
 *  matching real Staunton turnery instead of one flat trapezoid. */
function base(ctx, mat, w = 30) {
  // foot disc
  ctx.beginPath();
  ctx.moveTo(50 - w, 88);
  ctx.quadraticCurveTo(50, 95, 50 + w, 88);
  ctx.lineTo(50 + w - 3, 83.5);
  ctx.quadraticCurveTo(50, 89, 50 - w + 3, 83.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // collar step
  ctx.beginPath();
  ctx.moveTo(50 - w + 5, 83.5);
  ctx.lineTo(50 - w + 8, 79);
  ctx.lineTo(50 + w - 8, 79);
  ctx.lineTo(50 + w - 5, 83.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // thin engraved ring line for turnery detail
  ctx.save();
  ctx.strokeStyle = mat.detail;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(50 - w + 3, 85.6);
  ctx.lineTo(50 + w - 3, 85.6);
  ctx.stroke();
  ctx.restore();
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.moveTo(50 - w + 2, 87);
    ctx.quadraticCurveTo(50 - w * 0.5, 90.5, 50 - w * 0.15, 90.5);
  });
}

function collarRing(ctx, cy, w) {
  ctx.beginPath();
  ctx.ellipse(50, cy, w, w * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Pawn
// ---------------------------------------------------------------------------
function drawPawn(ctx, color) {
  const mat = style(ctx, color, 14, 88);
  // head
  ctx.beginPath();
  ctx.arc(50, 30, 11.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.arc(46, 26, 7, Math.PI * 1.1, Math.PI * 1.75);
  });
  // neck collar
  collarRing(ctx, 40.5, 8.5);
  // body (gentle hourglass)
  ctx.beginPath();
  ctx.moveTo(41.5, 43);
  ctx.quadraticCurveTo(50, 50, 58.5, 43);
  ctx.quadraticCurveTo(67, 60, 59.5, 75);
  ctx.lineTo(40.5, 75);
  ctx.quadraticCurveTo(33, 60, 41.5, 43);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.moveTo(39, 48);
    ctx.quadraticCurveTo(36, 60, 40, 71);
  });
  // skirt
  ctx.beginPath();
  ctx.moveTo(34, 75);
  ctx.lineTo(66, 75);
  ctx.lineTo(70, 83);
  ctx.lineTo(30, 83);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  base(ctx, mat, 25);
}

// ---------------------------------------------------------------------------
// Rook
// ---------------------------------------------------------------------------
function drawRook(ctx, color) {
  const mat = style(ctx, color, 12, 88);
  // crenellated top
  ctx.beginPath();
  ctx.moveTo(27, 26);
  ctx.lineTo(27, 13);
  ctx.lineTo(37, 13);
  ctx.lineTo(37, 19.5);
  ctx.lineTo(45, 19.5);
  ctx.lineTo(45, 13);
  ctx.lineTo(55, 13);
  ctx.lineTo(55, 19.5);
  ctx.lineTo(63, 19.5);
  ctx.lineTo(63, 13);
  ctx.lineTo(73, 13);
  ctx.lineTo(73, 26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.moveTo(29, 25);
    ctx.lineTo(29, 15);
  });
  // tapered tower body
  ctx.beginPath();
  ctx.moveTo(30, 26);
  ctx.lineTo(70, 26);
  ctx.lineTo(65.5, 36);
  ctx.lineTo(65.5, 62);
  ctx.lineTo(70.5, 76);
  ctx.lineTo(70.5, 83);
  ctx.lineTo(29.5, 83);
  ctx.lineTo(29.5, 76);
  ctx.lineTo(34.5, 62);
  ctx.lineTo(34.5, 36);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.moveTo(33, 32);
    ctx.lineTo(33, 60);
  });
  // banding ring for turnery detail
  ctx.save();
  ctx.strokeStyle = mat.detail;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(34.5, 48);
  ctx.lineTo(65.5, 48);
  ctx.stroke();
  ctx.restore();
  base(ctx, mat, 29);
}

// ---------------------------------------------------------------------------
// Bishop
// ---------------------------------------------------------------------------
function drawBishop(ctx, color) {
  const mat = style(ctx, color, 8, 84);
  // finial ball + slit mitre
  ctx.beginPath();
  ctx.arc(50, 15, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // mitre body
  ctx.beginPath();
  ctx.moveTo(50, 22);
  ctx.bezierCurveTo(69, 33, 67, 52, 56, 61);
  ctx.quadraticCurveTo(64, 68, 64.5, 74);
  ctx.lineTo(35.5, 74);
  ctx.quadraticCurveTo(36, 68, 44, 61);
  ctx.bezierCurveTo(33, 52, 31, 33, 50, 22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.moveTo(38, 32);
    ctx.quadraticCurveTo(34, 45, 39, 56);
  });
  // signature mitre slit (diagonal cross-cut)
  ctx.save();
  ctx.strokeStyle = mat.detail;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(41, 40);
  ctx.lineTo(58, 30);
  ctx.stroke();
  ctx.restore();
  // collar
  collarRing(ctx, 74.5, 15.5);
  // skirt
  ctx.beginPath();
  ctx.moveTo(33, 78);
  ctx.lineTo(67, 78);
  ctx.lineTo(71, 84);
  ctx.lineTo(29, 84);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  base(ctx, mat, 27);
}

// ---------------------------------------------------------------------------
// Knight
// ---------------------------------------------------------------------------
function drawKnight(ctx, color) {
  const mat = style(ctx, color, 8, 84);
  ctx.beginPath();
  ctx.moveTo(23, 80);
  ctx.lineTo(25.5, 65);
  ctx.quadraticCurveTo(28, 53, 23.5, 45);
  ctx.quadraticCurveTo(19, 37, 25.5, 29);
  ctx.quadraticCurveTo(30, 21, 41, 17);
  ctx.quadraticCurveTo(38.5, 11, 44.5, 9);
  ctx.quadraticCurveTo(49, 13, 47, 18.5);
  ctx.quadraticCurveTo(57.5, 17, 66, 23.5);
  ctx.quadraticCurveTo(76.5, 30, 78.5, 40.5);
  ctx.quadraticCurveTo(80.5, 45, 76, 47);
  ctx.lineTo(69.5, 40.5);
  ctx.quadraticCurveTo(63, 44.5, 63, 51);
  ctx.quadraticCurveTo(56.5, 47, 50, 49);
  ctx.quadraticCurveTo(58.5, 55, 63, 63);
  ctx.quadraticCurveTo(56.5, 65, 58.5, 71);
  ctx.quadraticCurveTo(65, 75, 69, 81);
  ctx.lineTo(77.5, 81);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.moveTo(25, 40);
    ctx.quadraticCurveTo(23, 55, 26, 68);
  });
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.moveTo(31, 24);
    ctx.quadraticCurveTo(37, 19, 43, 18);
  }, 0.4);
  // eye
  const light = color === 'w';
  ctx.save();
  ctx.fillStyle = light ? '#3a3226' : '#f0e9d8';
  ctx.beginPath();
  ctx.arc(48.5, 27.5, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // nostril accent
  ctx.save();
  ctx.strokeStyle = mat.detail;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(73, 41);
  ctx.quadraticCurveTo(70, 43, 68.5, 40.5);
  ctx.stroke();
  ctx.restore();
  base(ctx, mat, 29.5);
}

// ---------------------------------------------------------------------------
// Crown spikes (Queen) — five refined points with pearled tips
// ---------------------------------------------------------------------------
function crownSpikes(ctx, mat, cx, topY, count, spread, spikeH) {
  const start = cx - spread;
  const step = (spread * 2) / (count - 1);
  ctx.beginPath();
  ctx.moveTo(start, topY + spikeH);
  for (let i = 0; i < count; i++) {
    const x = start + step * i;
    ctx.lineTo(x, topY + (i % 2 === 0 ? 0 : spikeH * 0.32));
    if (i < count - 1) ctx.lineTo(x + step / 2, topY + spikeH * 0.62);
  }
  ctx.lineTo(cx + spread, topY + spikeH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < count; i++) {
    const x = start + step * i;
    const y = topY + (i % 2 === 0 ? 0 : spikeH * 0.32);
    ctx.beginPath();
    ctx.arc(x, y - 2.6, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawQueen(ctx, color) {
  const mat = style(ctx, color, 12, 84);
  crownSpikes(ctx, mat, 50, 24, 5, 21, 13);
  // crown band
  ctx.beginPath();
  ctx.moveTo(29, 37);
  ctx.quadraticCurveTo(50, 47, 71, 37);
  ctx.lineTo(65, 68);
  ctx.quadraticCurveTo(50, 74, 35, 68);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.moveTo(34, 42);
    ctx.quadraticCurveTo(31, 55, 36, 64);
  });
  // banded jewel line
  ctx.save();
  ctx.strokeStyle = mat.accent;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(33, 50);
  ctx.quadraticCurveTo(50, 57, 67, 50);
  ctx.stroke();
  ctx.restore();
  collarRing(ctx, 68.5, 16.5);
  // skirt
  ctx.beginPath();
  ctx.moveTo(33, 71);
  ctx.lineTo(67, 71);
  ctx.lineTo(71, 79);
  ctx.lineTo(29, 79);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  base(ctx, mat, 30);
}

// ---------------------------------------------------------------------------
// King — cross finial + tallest, most stately silhouette
// ---------------------------------------------------------------------------
function drawKing(ctx, color) {
  const mat = style(ctx, color, 8, 88);
  // cross finial
  ctx.beginPath();
  ctx.moveTo(46.5, 8);
  ctx.lineTo(53.5, 8);
  ctx.lineTo(53.5, 14.5);
  ctx.lineTo(59.5, 14.5);
  ctx.lineTo(59.5, 21);
  ctx.lineTo(53.5, 21);
  ctx.lineTo(53.5, 27.5);
  ctx.lineTo(46.5, 27.5);
  ctx.lineTo(46.5, 21);
  ctx.lineTo(40.5, 21);
  ctx.lineTo(40.5, 14.5);
  ctx.lineTo(46.5, 14.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // crown collar under cross
  collarRing(ctx, 30.5, 8.5);
  // crown body
  ctx.beginPath();
  ctx.moveTo(50, 31);
  ctx.bezierCurveTo(71, 37, 71.5, 54, 63.5, 63);
  ctx.quadraticCurveTo(69.5, 71, 67.5, 78);
  ctx.lineTo(32.5, 78);
  ctx.quadraticCurveTo(30.5, 71, 36.5, 63);
  ctx.bezierCurveTo(28.5, 54, 29, 37, 50, 31);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  rimLight(ctx, mat, () => {
    ctx.beginPath();
    ctx.moveTo(34, 40);
    ctx.quadraticCurveTo(30.5, 53, 36.5, 62);
  });
  // arched brow band (regal detail)
  ctx.save();
  ctx.strokeStyle = mat.accent;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(37, 47);
  ctx.quadraticCurveTo(50, 55, 63, 47);
  ctx.stroke();
  ctx.restore();
  collarRing(ctx, 78.5, 18.5);
  // skirt
  ctx.beginPath();
  ctx.moveTo(31, 81);
  ctx.lineTo(69, 81);
  ctx.lineTo(73.5, 88);
  ctx.lineTo(26.5, 88);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  base(ctx, mat, 32);
}

const DRAWERS = {
  p: drawPawn,
  r: drawRook,
  n: drawKnight,
  b: drawBishop,
  q: drawQueen,
  k: drawKing,
};

function scaled(ctx, cx, cy, size, fn) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 100, size / 100);
  fn();
  ctx.restore();
}

function shadowAt(ctx, cx, cy, size) {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.41, size * 0.29, size * 0.065, 0, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx, cy + size * 0.41, 0, cx, cy + size * 0.41, size * 0.29);
  g.addColorStop(0, 'rgba(0,0,0,0.32)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a piece at cell center (cx, cy) sized to `size`.
 * @param {string} type - one of p,r,n,b,q,k (lowercase)
 * @param {string} color - 'w' or 'b'
 */
function drawPiece(ctx, type, color, cx, cy, size) {
  const drawer = DRAWERS[type];
  if (!drawer) return;
  ctx.save();
  const s = size * 0.95;
  shadowAt(ctx, cx, cy, s);
  scaled(ctx, cx, cy, s, () => drawer(ctx, color));
  ctx.restore();
}

module.exports = { drawPiece };
