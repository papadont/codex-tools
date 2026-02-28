"use strict";

const os = require("os");
const path = require("path");
const { LocalAdapter } = require("./local_adapter");

class ICloudAdapter extends LocalAdapter {
  constructor(options = {}) {
    super({
      ...options,
      kind: "icloud",
      baseDir: options.baseDir
        || process.env.CODEX_MEMO_ICLOUD_DIR
        || path.join(
          os.homedir(),
          "Library",
          "Mobile Documents",
          "com~apple~CloudDocs",
          "codex-memo"
        )
    });
  }
}

module.exports = {
  ICloudAdapter
};
