"use strict";

function createMemoResponseCache(options = {}) {
  const now = options.now || Date.now;
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  function set(key, value, ttlMs) {
    store.set(key, {
      value,
      expiresAt: now() + Math.max(1, Number(ttlMs) || 1)
    });
  }

  function clear() {
    store.clear();
  }

  return { get, set, clear };
}

async function loadThroughMemoResponseCache({
  cache,
  key,
  ttlMs,
  forceReload = false,
  loader
}) {
  if (!forceReload) {
    const cached = cache.get(key);
    if (cached !== null) {
      return { value: cached, cacheHit: true };
    }
  }

  const value = await loader();
  cache.set(key, value, ttlMs);
  return { value, cacheHit: false };
}

module.exports = {
  createMemoResponseCache,
  loadThroughMemoResponseCache
};
