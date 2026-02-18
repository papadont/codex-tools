#!/usr/bin/env node

const path = require("path");
const express = require("express");
const admin = require("firebase-admin");

const PORT = Number(process.env.PORT || 4173);
const COLLECTION = "codex-memo";
const ALLOWED_MEMO_TYPES = new Set(["handover memo", "memo", "propomemo", "keep"]);
const CACHE_TTL_MS = Number(process.env.MEMO_CACHE_TTL_MS || 15_000);

const cacheStore = new Map();

function getCache(key) {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cacheStore.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlMs = CACHE_TTL_MS) {
  cacheStore.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, ttlMs)
  });
}

function clearCache() {
  cacheStore.clear();
}

function requireCredentials() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  }
}

function initFirestore() {
  requireCredentials();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
  }
  return admin.firestore();
}

function normalizeMemoType(raw) {
  if (!raw) return "memo";
  const value = String(raw).trim();
  if (!ALLOWED_MEMO_TYPES.has(value)) {
    throw new Error(
      `Invalid memoType. Use one of: ${Array.from(ALLOWED_MEMO_TYPES).join(", ")}`
    );
  }
  return value;
}

function normalizeString(raw, fieldName) {
  const value = String(raw || "").trim();
  if (!value) {
    throw new Error(`${fieldName} is required.`);
  }
  return value;
}

function normalizeBool(raw, defaultValue = false) {
  if (raw === undefined) return defaultValue;
  if (typeof raw === "boolean") return raw;
  const value = String(raw).toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Invalid boolean. Use true/false.");
}

function assertExclusiveFlags(pinned, deletable) {
  if (Boolean(pinned) && Boolean(deletable)) {
    throw new Error("pinned and deletable cannot both be true.");
  }
}

function assertDeleteAllowed(current, confirmToken) {
  if (!Boolean(current.deletable)) {
    throw new Error("Delete blocked. Set deletable=true before delete.");
  }
  if (String(confirmToken || "").trim().toUpperCase() !== "DELETE") {
    throw new Error('Delete confirmation token is required. Use "DELETE".');
  }
}

function toMemoDto(doc) {
  const data = doc.data() || {};
  const datetime = data.datetime && typeof data.datetime.toDate === "function"
    ? data.datetime.toDate()
    : null;
  return {
    id: doc.id,
    projectName: data.projectName || "",
    memoType: data.memoType || "memo",
    memoBody: data.memoBody || "",
    threadTitle: data.threadTitle || "",
    deletable: Boolean(data.deletable),
    pinned: Boolean(data.pinned),
    createdAtISO: data.createdAtISO || (datetime ? datetime.toISOString() : null),
    updatedAtISO: data.updatedAtISO || null,
    createdBy: data.createdBy || "",
    sourceThread: data.sourceThread || "",
    datetimeISO: datetime ? datetime.toISOString() : null
  };
}

function buildDownloadBody(memo, format) {
  if (format === "json") {
    return JSON.stringify(memo, null, 2);
  }

  if (format === "md") {
    return [
      `# ${memo.threadTitle || "(no title)"}`,
      "",
      `- id: ${memo.id}`,
      `- projectName: ${memo.projectName}`,
      `- memoType: ${memo.memoType}`,
      `- deletable: ${memo.deletable}`,
      `- createdAtISO: ${memo.createdAtISO || ""}`,
      `- updatedAtISO: ${memo.updatedAtISO || ""}`,
      "",
      "## Body",
      "",
      memo.memoBody || ""
    ].join("\n");
  }

  return [
    `title: ${memo.threadTitle || ""}`,
    `id: ${memo.id}`,
    `projectName: ${memo.projectName}`,
    `memoType: ${memo.memoType}`,
    `deletable: ${memo.deletable}`,
    `createdAtISO: ${memo.createdAtISO || ""}`,
    `updatedAtISO: ${memo.updatedAtISO || ""}`,
    "",
    memo.memoBody || ""
  ].join("\n");
}

async function main() {
  const db = initFirestore();
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(__dirname, "..", "codex-memo-web", "public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/memos", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const projectName = String(req.query.projectName || "").trim().toLowerCase();
      const memoType = String(req.query.memoType || "").trim().toLowerCase();
      const q = String(req.query.q || "").trim().toLowerCase();
      const noCache = String(req.query.nocache || "").trim() === "1";
      const cacheKey = `list:${JSON.stringify({ limit, projectName, memoType, q })}`;
      if (!noCache) {
        const cached = getCache(cacheKey);
        if (cached) {
          res.setHeader("X-Cache", "HIT");
          res.json(cached);
          return;
        }
      }

      const snap = await db
        .collection(COLLECTION)
        .orderBy("datetime", "desc")
        .limit(limit)
        .get();

      let memos = snap.docs.map(toMemoDto);

      if (projectName) {
        memos = memos.filter((memo) => memo.projectName.toLowerCase().includes(projectName));
      }
      if (memoType) {
        memos = memos.filter((memo) => memo.memoType.toLowerCase() === memoType);
      }
      if (q) {
        memos = memos.filter((memo) => {
          return (
            memo.threadTitle.toLowerCase().includes(q) ||
            memo.memoBody.toLowerCase().includes(q) ||
            memo.id.toLowerCase().includes(q)
          );
        });
      }

      const payload = { items: memos };
      if (!noCache) {
        setCache(cacheKey, payload);
      }
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to fetch memos." });
    }
  });

  app.get("/api/memos/:id", async (req, res) => {
    try {
      const cacheKey = `detail:${req.params.id}`;
      const cached = getCache(cacheKey);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.json(cached);
        return;
      }

      const doc = await db.collection(COLLECTION).doc(req.params.id).get();
      if (!doc.exists) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }
      const payload = { item: toMemoDto(doc) };
      setCache(cacheKey, payload);
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to fetch memo." });
    }
  });

  app.post("/api/memos", async (req, res) => {
    try {
      const now = new Date();
      const payload = {
        projectName: normalizeString(req.body.projectName, "projectName"),
        memoType: normalizeMemoType(req.body.memoType),
        memoBody: normalizeString(req.body.memoBody, "memoBody"),
        threadTitle: normalizeString(req.body.threadTitle, "threadTitle"),
        deletable: normalizeBool(req.body.deletable, false),
        pinned: normalizeBool(req.body.pinned, false),
        datetime: admin.firestore.Timestamp.fromDate(now),
        createdAtISO: now.toISOString(),
        updatedAtISO: now.toISOString(),
        createdBy: req.body.createdBy || "codex-memo-web",
        sourceThread: req.body.sourceThread || process.cwd()
      };
      assertExclusiveFlags(payload.pinned, payload.deletable);

      const ref = await db.collection(COLLECTION).add(payload);
      const created = await ref.get();
      clearCache();
      res.status(201).json({ item: toMemoDto(created) });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to create memo." });
    }
  });

  app.put("/api/memos/:id", async (req, res) => {
    try {
      const ref = db.collection(COLLECTION).doc(req.params.id);
      const exists = await ref.get();
      if (!exists.exists) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }

      const patch = {
        projectName: normalizeString(req.body.projectName, "projectName"),
        memoType: normalizeMemoType(req.body.memoType),
        memoBody: normalizeString(req.body.memoBody, "memoBody"),
        threadTitle: normalizeString(req.body.threadTitle, "threadTitle"),
        updatedAtISO: new Date().toISOString()
      };
      if (req.body.deletable !== undefined) {
        patch.deletable = normalizeBool(req.body.deletable, false);
      }
      if (req.body.pinned !== undefined) {
        patch.pinned = normalizeBool(req.body.pinned, false);
      }

      const current = exists.data() || {};
      const nextPinned = patch.pinned !== undefined ? patch.pinned : Boolean(current.pinned);
      const nextDeletable = patch.deletable !== undefined ? patch.deletable : Boolean(current.deletable);
      assertExclusiveFlags(nextPinned, nextDeletable);

      await ref.update(patch);
      const updated = await ref.get();
      clearCache();
      res.json({ item: toMemoDto(updated) });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to update memo." });
    }
  });

  app.delete("/api/memos/:id", async (req, res) => {
    try {
      const ref = db.collection(COLLECTION).doc(req.params.id);
      const exists = await ref.get();
      if (!exists.exists) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }
      const current = exists.data() || {};
      const confirmToken = req.get("x-codex-delete-confirm") || req.query.confirm;
      assertDeleteAllowed(current, confirmToken);
      await ref.delete();
      clearCache();
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to delete memo." });
    }
  });

  app.patch("/api/memos/:id/pin", async (req, res) => {
    try {
      const ref = db.collection(COLLECTION).doc(req.params.id);
      const exists = await ref.get();
      if (!exists.exists) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }

      const pinned = normalizeBool(req.body.pinned, false);
      const current = exists.data() || {};
      assertExclusiveFlags(pinned, Boolean(current.deletable));
      await ref.update({
        pinned,
        updatedAtISO: new Date().toISOString()
      });
      const updated = await ref.get();
      clearCache();
      res.json({ item: toMemoDto(updated) });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to update pin." });
    }
  });

  app.patch("/api/memos/:id/deletable", async (req, res) => {
    try {
      const ref = db.collection(COLLECTION).doc(req.params.id);
      const exists = await ref.get();
      if (!exists.exists) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }

      const deletable = normalizeBool(req.body.deletable, false);
      const current = exists.data() || {};
      assertExclusiveFlags(Boolean(current.pinned), deletable);
      await ref.update({
        deletable,
        updatedAtISO: new Date().toISOString()
      });
      const updated = await ref.get();
      clearCache();
      res.json({ item: toMemoDto(updated) });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to update deletable flag." });
    }
  });

  app.get("/api/memos/:id/download", async (req, res) => {
    try {
      const format = String(req.query.format || "txt").toLowerCase();
      if (!["txt", "md", "json"].includes(format)) {
        res.status(400).json({ error: "format must be txt|md|json." });
        return;
      }

      const doc = await db.collection(COLLECTION).doc(req.params.id).get();
      if (!doc.exists) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }

      const memo = toMemoDto(doc);
      const body = buildDownloadBody(memo, format);
      const safeTitle = (memo.threadTitle || memo.id).replace(/[^\w\-]+/g, "_").slice(0, 50);
      const filename = `${safeTitle || memo.id}.${format}`;
      const typeMap = {
        txt: "text/plain; charset=utf-8",
        md: "text/markdown; charset=utf-8",
        json: "application/json; charset=utf-8"
      };

      res.setHeader("Content-Type", typeMap[format]);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(body);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to download memo." });
    }
  });

  app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "codex-memo-web", "public", "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`codex-memo web app running: http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error("Failed to start codex-memo web app:", error.message);
  process.exit(1);
});
