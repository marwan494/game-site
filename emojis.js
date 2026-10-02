'use strict';

const fs = require('fs');
const path = require('path');

const MAP_FILE = path.join(__dirname, '..', '..', 'assets', 'emojis.json');
let map = {};
let warned = false;

function loadMap() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
    map = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    map = {};
  }
}

function saveMap(next) {
  map = { ...next };
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2) + '\n', 'utf8');
}

loadMap();

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn('⚠️ Application emojis are unavailable — they will sync automatically when the bot starts successfully.');
}

function emoji(name) {
  const key = `cm_${name}`;
  const id = map[key];
  if (id) return `<:${key}:${id}>`;
  warnOnce();
  return `【${name}】`;
}

function emojiObj(name) {
  const key = `cm_${name}`;
  const id = map[key];
  if (!id) {
    warnOnce();
    return null;
  }
  return { id, name: key };
}

function setApplicationEmojiMap(next) {
  saveMap(next);
}

function getApplicationEmojiMap() {
  return { ...map };
}

module.exports = {
  emoji,
  emojiObj,
  setApplicationEmojiMap,
  getApplicationEmojiMap,
};
