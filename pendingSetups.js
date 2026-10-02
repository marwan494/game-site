'use strict';

const crypto = require('crypto');

const pending = new Map();

function create(data) {
  const token = crypto.randomBytes(12).toString('hex');
  pending.set(token, { ...data, createdAt: Date.now() });
  // auto-expire after 5 minutes to avoid unbounded growth
  setTimeout(() => pending.delete(token), 5 * 60 * 1000).unref();
  return token;
}

function get(token) {
  return pending.get(token);
}

function remove(token) {
  pending.delete(token);
}

module.exports = { create, get, remove };
