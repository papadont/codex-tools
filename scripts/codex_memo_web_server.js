#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const express = require("express");
const admin = require("firebase-admin");
const { GoogleAuth } = require("google-auth-library");

const PORT = Number(process.env.PORT || 4173);
const COLLECTION = "codex-memo";
const ALLOWED_MEMO_TYPES = new Set(["handover memo", "memo", "propomemo", "keep"]);
const CACHE_TTL_MS = Number(process.env.MEMO_CACHE_TTL_MS || 15_000);
const USAGE_CACHE_TTL_MS = Number(process.env.USAGE_CACHE_TTL_MS || 180_000);
const CODEX_USAGE_CACHE_TTL_MS = Number(process.env.CODEX_USAGE_CACHE_TTL_MS || 30_000);
const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";

const USAGE_METRIC_CANDIDATES = {
  read: [
    "firestore.googleapis.com/document/read_count",
    "firestore.googleapis.com/document/read_ops_count"
  ],
  write: [
    "firestore.googleapis.com/document/write_count",
    "firestore.googleapis.com/document/write_ops_count"
  ],
  delete: [
    "firestore.googleapis.com/document/delete_count",
    "firestore.googleapis.com/document/delete_ops_count"
  ]
};

const DAILY_FREE_TIER_LIMITS = {
  read: 50_000,
  write: 20_000,
  delete: 20_000
};

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

function getUtcDateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function toPointNumber(point) {
  const value = point && point.value ? point.value : {};
  if (value.int64Value !== undefined) return Number(value.int64Value);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.distributionValue !== undefined) return Number(value.distributionValue.count || 0);
  return 0;
}

function percentOf(value, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return (value / total) * 100;
}

function buildDateList(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const days = [];
  const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (current <= endDay) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

async function fetchMonitoringDailyTotals({
  projectId,
  metricType,
  startTime,
  endTime
}) {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/monitoring.read"]
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
  if (!accessToken) {
    throw new Error("Failed to get Monitoring access token.");
  }

  let pageToken = "";
  let points = 0;
  const daily = new Map();

  do {
    const qs = new URLSearchParams({
      filter: `metric.type="${metricType}"`,
      "interval.startTime": startTime,
      "interval.endTime": endTime,
      view: "FULL",
      "aggregation.alignmentPeriod": "86400s",
      "aggregation.perSeriesAligner": "ALIGN_SUM",
      "aggregation.crossSeriesReducer": "REDUCE_SUM"
    });
    if (pageToken) qs.set("pageToken", pageToken);

    const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${qs.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Monitoring API error (${res.status}) for ${metricType}: ${body}`);
    }

    const payload = await res.json();
    const series = Array.isArray(payload.timeSeries) ? payload.timeSeries : [];
    for (const s of series) {
      const arr = Array.isArray(s.points) ? s.points : [];
      points += arr.length;
      for (const p of arr) {
        const day = getUtcDateKey(p?.interval?.endTime || p?.interval?.startTime);
        if (!day) continue;
        daily.set(day, (daily.get(day) || 0) + toPointNumber(p));
      }
    }
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return { metricType, daily, points };
}

async function fetchBestUsageMetric({
  projectId,
  startTime,
  endTime,
  candidates
}) {
  let last = null;
  for (const metricType of candidates) {
    const result = await fetchMonitoringDailyTotals({
      projectId,
      metricType,
      startTime,
      endTime
    });
    last = result;
    let total = 0;
    for (const value of result.daily.values()) total += value;
    if (result.points > 0 || total > 0) {
      return result;
    }
  }
  return last || { metricType: candidates[0], daily: new Map(), points: 0 };
}

async function getFirestoreUsagePayload({ hours }) {
  requireCredentials();
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/monitoring.read"]
  });
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || await auth.getProjectId();
  if (!projectId) {
    throw new Error("Project ID could not be resolved for Monitoring.");
  }

  const end = new Date();
  const start = new Date(end.getTime() - (hours * 60 * 60 * 1000));
  const startTime = start.toISOString();
  const endTime = end.toISOString();
  const days = buildDateList(startTime, endTime);

  const [read, write, del] = await Promise.all([
    fetchBestUsageMetric({
      projectId,
      startTime,
      endTime,
      candidates: USAGE_METRIC_CANDIDATES.read
    }),
    fetchBestUsageMetric({
      projectId,
      startTime,
      endTime,
      candidates: USAGE_METRIC_CANDIDATES.write
    }),
    fetchBestUsageMetric({
      projectId,
      startTime,
      endTime,
      candidates: USAGE_METRIC_CANDIDATES.delete
    })
  ]);

  const perDay = days.map((date) => {
    const readCount = read.daily.get(date) || 0;
    const writeCount = write.daily.get(date) || 0;
    const deleteCount = del.daily.get(date) || 0;
    return {
      date,
      read: readCount,
      write: writeCount,
      delete: deleteCount,
      total: readCount + writeCount + deleteCount,
      ratePercent: {
        read: percentOf(readCount, DAILY_FREE_TIER_LIMITS.read),
        write: percentOf(writeCount, DAILY_FREE_TIER_LIMITS.write),
        delete: percentOf(deleteCount, DAILY_FREE_TIER_LIMITS.delete)
      }
    };
  });

  const totals = {
    read: perDay.reduce((acc, d) => acc + d.read, 0),
    write: perDay.reduce((acc, d) => acc + d.write, 0),
    delete: perDay.reduce((acc, d) => acc + d.delete, 0)
  };

  return {
    projectId,
    windowHours: hours,
    startTime,
    endTime,
    limitsDaily: DAILY_FREE_TIER_LIMITS,
    totals,
    ratePercentOfDailyFreeTier: {
      read: percentOf(totals.read, DAILY_FREE_TIER_LIMITS.read),
      write: percentOf(totals.write, DAILY_FREE_TIER_LIMITS.write),
      delete: percentOf(totals.delete, DAILY_FREE_TIER_LIMITS.delete)
    },
    metricTypes: {
      read: read.metricType,
      write: write.metricType,
      delete: del.metricType
    },
    perDay,
    note: "Cloud Monitoring sampled metrics are typically delayed by up to a few minutes."
  };
}

function requireCredentials() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  }
}

function formatResetAtISO(epochSeconds) {
  const n = Number(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function mapRateLimitWindow(window) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = Number(window.used_percent || 0);
  const limitWindowSeconds = Number(window.limit_window_seconds || 0);
  const resetAfterSeconds = Number(window.reset_after_seconds || 0);
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    limitWindowSeconds,
    resetAfterSeconds,
    resetAtISO: formatResetAtISO(window.reset_at)
  };
}

function getCodexAccessToken() {
  const authPath = path.join(process.env.HOME || "", ".codex", "auth.json");
  if (!authPath || !fs.existsSync(authPath)) {
    throw new Error("Codex auth.json not found.");
  }
  const raw = fs.readFileSync(authPath, "utf8");
  const json = JSON.parse(raw);
  const token = json?.tokens?.access_token;
  if (!token || typeof token !== "string") {
    throw new Error("Codex access token is missing in auth.json.");
  }
  return token;
}

async function getCodexUsagePayload() {
  const token = getCodexAccessToken();
  const res = await fetch(CODEX_USAGE_ENDPOINT, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.detail || body?.error || `Codex usage API error (${res.status})`);
  }

  return {
    fetchedAtISO: new Date().toISOString(),
    planType: String(body?.plan_type || "-"),
    allowed: Boolean(body?.rate_limit?.allowed),
    limitReached: Boolean(body?.rate_limit?.limit_reached),
    primaryWindow: mapRateLimitWindow(body?.rate_limit?.primary_window),
    secondaryWindow: mapRateLimitWindow(body?.rate_limit?.secondary_window),
    codeReviewWindow: mapRateLimitWindow(body?.code_review_rate_limit?.primary_window),
    credits: {
      hasCredits: Boolean(body?.credits?.has_credits),
      unlimited: Boolean(body?.credits?.unlimited),
      balance: String(body?.credits?.balance ?? "0"),
      approxLocalMessages: Array.isArray(body?.credits?.approx_local_messages) ? body.credits.approx_local_messages : [0, 0],
      approxCloudMessages: Array.isArray(body?.credits?.approx_cloud_messages) ? body.credits.approx_cloud_messages : [0, 0]
    }
  };
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
  if (Boolean(current.pinned)) {
    throw new Error("Delete blocked. Unpin this memo before delete.");
  }
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

      // Avoid excluding legacy docs that do not have the "datetime" field.
      const snap = await db
        .collection(COLLECTION)
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

  app.get("/api/usage/firestore", async (req, res) => {
    try {
      const hours = Math.min(Math.max(Number(req.query.hours) || 24 * 14, 1), 24 * 60);
      const noCache = String(req.query.nocache || "").trim() === "1";
      const cacheKey = `usage:${hours}`;
      if (!noCache) {
        const cached = getCache(cacheKey);
        if (cached) {
          res.setHeader("X-Cache", "HIT");
          res.json(cached);
          return;
        }
      }

      const payload = await getFirestoreUsagePayload({ hours });
      if (!noCache) {
        setCache(cacheKey, payload, USAGE_CACHE_TTL_MS);
      }
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to fetch Firestore usage." });
    }
  });

  app.get("/api/usage/codex", async (req, res) => {
    try {
      const noCache = String(req.query.nocache || "").trim() === "1";
      const cacheKey = "usage:codex";
      if (!noCache) {
        const cached = getCache(cacheKey);
        if (cached) {
          res.setHeader("X-Cache", "HIT");
          res.json(cached);
          return;
        }
      }

      const payload = await getCodexUsagePayload();
      if (!noCache) {
        setCache(cacheKey, payload, CODEX_USAGE_CACHE_TTL_MS);
      }
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to fetch Codex usage." });
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
