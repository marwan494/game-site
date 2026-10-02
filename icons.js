'use strict';

/**
 * Deterministic luxury emoji pack.
 *
 * The visual source of truth lives in assets/emoji-master/*.png. Keeping the
 * renderer asset-backed means the bot can reproduce the exact same art when it
 * creates or refreshes its own Application Emojis at startup.
 */
const fs = require('fs');
const path = require('path');

const ICON_NAMES = [
  'ai', 'cancel', 'capture', 'challenge', 'check', 'checkmate', 'confirm', 'draw',
  'flip', 'hint', 'history', 'move', 'promote', 'random', 'resign', 'takeback',
  'trophy', 'win', 'king', 'queen', 'rook', 'bishop', 'knight', 'pawn', 'live',
  'white', 'black',
];

const MASTER_DIR = path.join(__dirname, '..', '..', 'assets', 'emoji-master');

function renderIcon(name) {
  if (!ICON_NAMES.includes(name)) throw new Error(`Unknown icon: ${name}`);
  const file = path.join(MASTER_DIR, `cm_${name}.png`);
  if (!fs.existsSync(file)) throw new Error(`Missing emoji master asset: ${file}`);
  return fs.readFileSync(file);
}

module.exports = { renderIcon, ICON_NAMES };
