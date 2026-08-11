const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMemoResponseCache,
  loadThroughMemoResponseCache
} = require("../scripts/memo_response_cache");

test("memo response cache reuses values until the TTL expires", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = createMemoResponseCache({ now: () => now });
  const load = () => loadThroughMemoResponseCache({
    cache,
    key: "list:all",
    ttlMs: 600_000,
    loader: async () => ({ generation: ++loads })
  });

  assert.deepEqual(await load(), {
    value: { generation: 1 },
    cacheHit: false
  });
  assert.deepEqual(await load(), {
    value: { generation: 1 },
    cacheHit: true
  });

  now += 600_001;
  assert.deepEqual(await load(), {
    value: { generation: 2 },
    cacheHit: false
  });
});

test("forced reload replaces the cached value for later requests", async () => {
  let loads = 0;
  const cache = createMemoResponseCache();
  const load = (forceReload = false) => loadThroughMemoResponseCache({
    cache,
    key: "detail:memo-1",
    ttlMs: 86_400_000,
    forceReload,
    loader: async () => ({ generation: ++loads })
  });

  await load();
  assert.deepEqual(await load(true), {
    value: { generation: 2 },
    cacheHit: false
  });
  assert.deepEqual(await load(), {
    value: { generation: 2 },
    cacheHit: true
  });
});
