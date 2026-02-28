"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { STORAGE_KINDS, normalizeStorageKind, resolveRuntimeConfig } = require("../scripts/runtime_config");

test("runtime config exposes only iCloud and Firebase storages", () => {
  assert.deepEqual(STORAGE_KINDS, ["icloud", "firebase"]);
  assert.equal(normalizeStorageKind("icloud"), "icloud");
  assert.equal(normalizeStorageKind("firebase"), "firebase");
  assert.throws(() => normalizeStorageKind("local"), /Invalid adapter/);
});

test("mixed mode allows only iCloud and Firebase", () => {
  const config = resolveRuntimeConfig([], {});
  assert.deepEqual(config.availableAdapters, ["icloud", "firebase"]);
  assert.deepEqual(config.allowedAdapters, ["icloud", "firebase"]);
});

test("fixed mode resolves adapter from env", () => {
  const config = resolveRuntimeConfig([], {
    CODEX_MEMO_ADAPTER: "firebase"
  });
  assert.equal(config.storageMode, "fixed");
  assert.equal(config.fixedAdapter, "firebase");
  assert.deepEqual(config.allowedAdapters, ["firebase"]);
  assert.equal(config.defaultStorageKind, "firebase");
});
