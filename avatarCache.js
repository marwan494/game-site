'use strict';

const { loadImage } = require('@napi-rs/canvas');

/**
 * Small in-memory cache of decoded Discord avatar images, keyed by URL.
 * The board is re-rendered on almost every interaction (move preview,
 * confirm, opponent's reply...), so without this we'd re-download and
 * re-decode both players' avatars dozens of times per game. Failures
 * (network hiccup, bad URL, slow CDN) are cached too — as `null` — so a
 * single broken avatar can never repeatedly slow down or break board
 * rendering; the renderer just falls back to a generated placeholder.
 */

const cache = new Map(); // url -> Promise<Image|null>
const MAX_ENTRIES = 400;
const FETCH_TIMEOUT_MS = 3500;

async function fetchAvatarBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string|null|undefined} url
 * @returns {Promise<import('@napi-rs/canvas').Image|null>}
 */
function loadAvatarImage(url) {
  if (!url) return Promise.resolve(null);
  const cached = cache.get(url);
  if (cached) return cached;

  const promise = (async () => {
    const buf = await fetchAvatarBuffer(url);
    if (!buf) return null;
    try {
      return await loadImage(buf);
    } catch (e) {
      return null;
    }
  })();

  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(url, promise);
  return promise;
}

module.exports = { loadAvatarImage };
