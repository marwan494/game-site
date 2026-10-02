'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'games.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readAll() {
  ensureFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeAll(items) {
  ensureFile();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function upsert(snapshot) {
  const items = readAll();
  const idx = items.findIndex((x) => x.id === snapshot.id);
  if (idx === -1) items.push(snapshot);
  else items[idx] = snapshot;
  writeAll(items);
}

function remove(id) {
  const items = readAll();
  const next = items.filter((x) => x.id !== id);
  if (next.length !== items.length) writeAll(next);
}

function load() {
  return readAll();
}

module.exports = { upsert, remove, load };
