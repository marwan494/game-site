'use strict';

const crypto = require('crypto');

/**
 * Short-lived store for "move under consideration" state: once a player
 * has picked a from/to (and promotion piece, if any), we stash the exact
 * move input here and hand back a small token. The board then shows a
 * live preview (arrow + resulting position) with Confirm/Cancel buttons
 * that reference the token — nothing is applied to the real game until
 * the player explicitly confirms.
 */
const pending = new Map();

function create(data) {
  const token = crypto.randomBytes(12).toString('hex');
  pending.set(token, { ...data, createdAt: Date.now() });
  // Auto-expire quickly — this is a transient "are you sure?" step, not
  // long-term state, so we don't want stale tokens piling up.
  setTimeout(() => pending.delete(token), 3 * 60 * 1000).unref();
  return token;
}

function get(token) {
  return pending.get(token);
}

function remove(token) {
  pending.delete(token);
}

module.exports = { create, get, remove };
