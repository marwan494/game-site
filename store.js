'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'players.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf8');
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeAll(data) {
  ensureFile();
  // atomic-ish write: write to temp then rename
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

/**
 * Player stats storage. ELO/rating was intentionally removed for human
 * players — ratings now exist only for AI difficulty tiers (see
 * difficultyLevels.js). Humans are tracked purely by win/loss/draw
 * record, which is simpler, can't be gamed by dodging strong opponents,
 * and doesn't require picking a K-factor or seeding logic.
 */
function defaultPlayer(id, name) {
  return { id, name, wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
}

function getPlayer(id, name) {
  const all = readAll();
  if (!all[id]) {
    all[id] = defaultPlayer(id, name || id);
    writeAll(all);
  } else if (name && all[id].name !== name) {
    all[id].name = name;
    writeAll(all);
  }
  return all[id];
}

function saveResult(whiteId, whiteName, blackId, blackName, result) {
  // result: 'white' | 'black' | 'draw'
  const all = readAll();
  if (!all[whiteId]) all[whiteId] = defaultPlayer(whiteId, whiteName);
  if (!all[blackId]) all[blackId] = defaultPlayer(blackId, blackName);
  all[whiteId].name = whiteName;
  all[blackId].name = blackName;

  const white = all[whiteId];
  const black = all[blackId];

  white.gamesPlayed += 1;
  black.gamesPlayed += 1;

  if (result === 'white') {
    white.wins += 1;
    black.losses += 1;
  } else if (result === 'black') {
    black.wins += 1;
    white.losses += 1;
  } else {
    white.draws += 1;
    black.draws += 1;
  }

  writeAll(all);
  return { white, black };
}

function leaderboard(limit = 10) {
  const all = readAll();
  return Object.values(all)
    .filter((p) => p.gamesPlayed > 0)
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
      return a.losses - b.losses;
    })
    .slice(0, limit);
}

module.exports = { getPlayer, saveResult, leaderboard };
