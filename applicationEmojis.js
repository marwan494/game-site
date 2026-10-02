'use strict';

const fs = require('fs');
const path = require('path');
const { setApplicationEmojiMap } = require('./emojis');
const { ICON_NAMES } = require('../render/icons');

const MASTER_DIR = path.join(__dirname, '..', '..', 'assets', 'emoji-master');
const MAP_FILE = path.join(__dirname, '..', '..', 'assets', 'emojis.json');

function readMap() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeMap(map) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2) + '\n', 'utf8');
}

async function syncApplicationEmojis(client, { createMissing = true } = {}) {
  const app = client.application;
  await app.fetch();
  const existing = await app.emojis.fetch();
  const byName = new Map([...existing.values()].map((e) => [e.name, e]));
  const map = readMap();

  let created = 0;
  let recovered = 0;
  const expected = ICON_NAMES.map((name) => `cm_${name}`);

  for (const name of expected) {
    const existingEmoji = byName.get(name);
    if (existingEmoji) {
      if (map[name] !== existingEmoji.id) {
        map[name] = existingEmoji.id;
        recovered += 1;
      }
      continue;
    }
    if (!createMissing) continue;
    const asset = path.join(MASTER_DIR, `${name}.png`);
    if (!fs.existsSync(asset)) {
      console.warn(`⚠️ Missing emoji asset: ${asset}`);
      continue;
    }
    try {
      const createdEmoji = await app.emojis.create({ attachment: asset, name });
      map[name] = createdEmoji.id;
      created += 1;
      console.log(`✅ Application emoji created: ${name}`);
    } catch (err) {
      console.warn(`⚠️ Could not create application emoji ${name}:`, err.message || err);
    }
  }

  writeMap(map);
  setApplicationEmojiMap(map);
  console.log(`♟️ Application emojis ready: ${expected.filter((name) => map[name]).length}/${expected.length} (${created} created, ${recovered} IDs refreshed)`);
  return map;
}

module.exports = { syncApplicationEmojis };
