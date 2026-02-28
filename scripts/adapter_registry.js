"use strict";

const { ICloudAdapter } = require("./storage_adapters/icloud_adapter");
const { FirebaseAdapter } = require("./storage_adapters/firebase_adapter");

function createAdapterRegistry(options = {}) {
  const adapters = new Map();
  const register = (adapter) => {
    adapters.set(adapter.kind, adapter);
    return adapter;
  };

  register(new ICloudAdapter(options.icloud));
  register(new FirebaseAdapter(options.firebase));

  return {
    listKinds() {
      return Array.from(adapters.keys());
    },
    getAdapter(kind) {
      const adapter = adapters.get(kind);
      if (!adapter) throw new Error(`Unknown adapter: ${kind}`);
      return adapter;
    }
  };
}

module.exports = {
  createAdapterRegistry
};
