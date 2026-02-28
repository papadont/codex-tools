"use strict";

class StorageAdapter {
  constructor(kind) {
    this.kind = kind;
  }

  async saveMemo(_input) {
    throw new Error(`saveMemo is not implemented for ${this.kind}`);
  }

  async loadMemo(_memoId) {
    throw new Error(`loadMemo is not implemented for ${this.kind}`);
  }

  async deleteMemo(_memoId) {
    return;
  }

  async saveAttachment(_input) {
    throw new Error(`saveAttachment is not implemented for ${this.kind}`);
  }

  async deleteAttachment(_memoId, _attachmentId) {
    throw new Error(`deleteAttachment is not implemented for ${this.kind}`);
  }

  async resolveAttachmentUrl(_input) {
    return null;
  }

  async copyMemoTo(_targetAdapter, _memoId) {
    throw new Error(`copyMemoTo is not implemented for ${this.kind}`);
  }
}

module.exports = {
  StorageAdapter
};
