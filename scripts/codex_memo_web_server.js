#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const express = require("express");
const admin = require("firebase-admin");
const { GoogleAuth } = require("google-auth-library");
const { createAdapterRegistry } = require("./adapter_registry");
const { loadEnvFromCandidates } = require("./load_env");
const { createMemoService } = require("./memo_service");
const { normalizeAttachments } = require("./memo_sync_service");
const { normalizeStorageKind, resolveRuntimeConfig } = require("./runtime_config");

loadEnvFromCandidates();

const PORT = Number(process.env.PORT || 4173);
const COLLECTION = "codex-memo";
const ALLOWED_MEMO_TYPES = new Set(["handover memo", "memo", "propomemo", "keep"]);
const CACHE_TTL_MS = Number(process.env.MEMO_CACHE_TTL_MS || 15_000);
const USAGE_CACHE_TTL_MS = Number(process.env.USAGE_CACHE_TTL_MS || 180_000);
const CODEX_USAGE_CACHE_TTL_MS = Number(process.env.CODEX_USAGE_CACHE_TTL_MS || 30_000);
const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

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
const runtimeConfig = resolveRuntimeConfig(process.argv.slice(2), process.env);

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
  const storageBucket = process.env.CODEX_MEMO_FIREBASE_BUCKET || undefined;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      storageBucket
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

function normalizeAttachmentsInput(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error("attachments must be an array.");
  }
  return normalizeAttachments(raw).map((item) => {
    const next = { ...item };
    if (next.dataUrl && !/^data:[^;,]+;base64,/.test(next.dataUrl)) {
      throw new Error(`Invalid dataUrl for attachment ${next.id}.`);
    }
    return next;
  });
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
  let storageKind;
  try {
    storageKind = normalizeStorageKind(data.storageKind, "firebase");
  } catch (_error) {
    storageKind = String(data.storageKind || "firebase").trim().toLowerCase() || "firebase";
  }
  return {
    id: doc.id,
    projectName: data.projectName || "",
    memoType: data.memoType || "memo",
    memoBody: data.memoBody || "",
    threadTitle: data.threadTitle || "",
    storageKind,
    attachments: normalizeAttachments(data.attachments),
    deletable: Boolean(data.deletable),
    pinned: Boolean(data.pinned),
    createdAtISO: data.createdAtISO || (datetime ? datetime.toISOString() : null),
    updatedAtISO: data.updatedAtISO || null,
    createdBy: data.createdBy || "",
    sourceThread: data.sourceThread || "",
    datetimeISO: datetime ? datetime.toISOString() : null
  };
}

function getAdapterRuntimeDetails(adapterRegistry) {
  return runtimeConfig.availableAdapters.map((kind) => {
    const adapter = adapterRegistry.getAdapter(kind);
    return {
      kind,
      path: adapter.baseDir || (kind === "firebase" ? `Cloud Storage bucket: ${adapter.bucketName || "-"}` : "")
    };
  });
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
      `- storageKind: ${memo.storageKind || "firebase"}`,
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
    `storageKind: ${memo.storageKind || "firebase"}`,
    `deletable: ${memo.deletable}`,
    `createdAtISO: ${memo.createdAtISO || ""}`,
    `updatedAtISO: ${memo.updatedAtISO || ""}`,
    "",
    memo.memoBody || ""
  ].join("\n");
}

function normalizeOpenPath(raw) {
  const requestedPath = String(raw || "").trim();
  if (!requestedPath) throw new Error("path is required.");
  if (requestedPath.includes("\0")) throw new Error("Invalid path.");
  let value = requestedPath
    .replace(/^[("'`[\{<]+/, "")
    .replace(/[)"'`\]}>.,;!?]+$/, "")
    .trim();
  if (!path.isAbsolute(value)) throw new Error("path must be absolute.");

  const candidates = [
    value,
    value.replace(/:(?:\d+(?:-\d+)?)(?:[,\s]+(?:\d+(?:-\d+)?))*\s*$/, "").trim(),
    value.replace(/:\d[\d,\-\s]*$/, "").trim(),
    value.replace(/\s+\d+(?:-\d+)?(?:[,\s]+\d+(?:-\d+)?)*\s*$/, "").trim()
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { requestedPath, normalizedPath: candidate };
    }
  }
  throw new Error("File not found.");
}

function openPathWithDefaultApp(targetPath) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", targetPath]
    : [targetPath];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

function extractOpenAIResponseText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const text = typeof part?.text === "string" ? part.text : "";
      if (text) chunks.push(text);
    }
  }
  return chunks.join("\n").trim();
}

function getFirestoreTodaySnapshotFromSummary(firestoreSummary) {
  const perDay = Array.isArray(firestoreSummary?.perDay) ? firestoreSummary.perDay : [];
  const today = perDay[perDay.length - 1] || { read: 0, write: 0, delete: 0, ratePercent: {} };
  const recent = perDay.slice(-14);
  const limits = firestoreSummary?.limitsDaily || { read: 50000, write: 20000, delete: 20000 };
  const ratePercent = {
    read: Number(today?.ratePercent?.read ?? ((Number(today.read || 0) / Math.max(1, Number(limits.read || 1))) * 100)),
    write: Number(today?.ratePercent?.write ?? ((Number(today.write || 0) / Math.max(1, Number(limits.write || 1))) * 100)),
    delete: Number(today?.ratePercent?.delete ?? ((Number(today.delete || 0) / Math.max(1, Number(limits.delete || 1))) * 100))
  };
  const maxInRecent = {
    read: Math.max(1, ...recent.map((d) => Number(d.read || 0))),
    write: Math.max(1, ...recent.map((d) => Number(d.write || 0))),
    delete: Math.max(1, ...recent.map((d) => Number(d.delete || 0)))
  };
  const relativePercent = {
    read: (Number(today.read || 0) / Math.max(1, Number(maxInRecent.read || 1))) * 100,
    write: (Number(today.write || 0) / Math.max(1, Number(maxInRecent.write || 1))) * 100,
    delete: (Number(today.delete || 0) / Math.max(1, Number(maxInRecent.delete || 1))) * 100
  };
  return { ratePercent, relativePercent };
}

function computeFirestore14dTrendFromSummary(firestoreSummary) {
  const perDay = Array.isArray(firestoreSummary?.perDay) ? firestoreSummary.perDay : [];
  const last14 = perDay.slice(-14);
  const first7 = last14.slice(0, 7);
  const last7 = last14.slice(-7);
  const sum = (rows, key) => rows.reduce((acc, row) => acc + Number(row?.[key] || 0), 0);
  const avg = (rows, key) => (rows.length ? sum(rows, key) / rows.length : 0);
  const latest = last14[last14.length - 1] || null;
  const prev = last14[last14.length - 2] || null;
  const avgRate = (rows, key) => {
    if (!rows.length) return 0;
    return rows.reduce((acc, row) => acc + Number(row?.ratePercent?.[key] || 0), 0) / rows.length;
  };
  const maxRate = (rows, key) => rows.reduce((m, row) => Math.max(m, Number(row?.ratePercent?.[key] || 0)), 0);
  const trend = {};
  for (const key of ["read", "write", "delete"]) {
    const avgFirst7 = avg(first7, key);
    const avgLast7 = avg(last7, key);
    trend[key] = {
      avgFirst7,
      avgLast7,
      deltaAvg: avgLast7 - avgFirst7,
      deltaDay: Number(latest?.[key] || 0) - Number(prev?.[key] || 0),
      latestRate: Number(latest?.ratePercent?.[key] || 0),
      prevRate: Number(prev?.ratePercent?.[key] || 0),
      deltaRateDay: Number(latest?.ratePercent?.[key] || 0) - Number(prev?.ratePercent?.[key] || 0),
      avgRateFirst7: avgRate(first7, key),
      avgRateLast7: avgRate(last7, key),
      deltaAvgRate: avgRate(last7, key) - avgRate(first7, key),
      maxRate14d: maxRate(last14, key)
    };
  }
  return { latest, trend };
}

function buildCodexWeeklyTimingContext(codexSummary) {
  const fetchedAtISO = codexSummary?.fetchedAtISO || new Date().toISOString();
  const resetAtISO = codexSummary?.secondaryWindow?.resetAtISO || "";
  const fetched = new Date(fetchedAtISO);
  const reset = new Date(resetAtISO);
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const fetchedMs = fetched.getTime();
  const resetMs = reset.getTime();
  const diffMs = Number.isFinite(fetchedMs) && Number.isFinite(resetMs) ? Math.max(0, resetMs - fetchedMs) : NaN;
  const hours = Number.isFinite(diffMs) ? diffMs / (1000 * 60 * 60) : null;
  const days = Number.isFinite(diffMs) ? diffMs / (1000 * 60 * 60 * 24) : null;
  return {
    fetchedAtISO,
    currentWeekdayLocal: Number.isFinite(fetchedMs) ? weekdayNames[fetched.getDay()] : null,
    weeklyResetAtISO: resetAtISO || null,
    daysUntilWeeklyReset: Number.isFinite(days) ? Number(days.toFixed(2)) : null,
    hoursUntilWeeklyReset: Number.isFinite(hours) ? Math.round(hours) : null
  };
}

async function summarizeUsageOverviewWithOpenAI({ firestoreSummary, codexSummary }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  if (!firestoreSummary || !codexSummary) throw new Error("firestoreSummary and codexSummary are required.");

  const fsToday = getFirestoreTodaySnapshotFromSummary(firestoreSummary);
  const fsTrend = computeFirestore14dTrendFromSummary(firestoreSummary);
  const codexPrimary = codexSummary?.primaryWindow || null;
  const codexSecondary = codexSummary?.secondaryWindow || null;
  const codexWeeklyTiming = buildCodexWeeklyTimingContext(codexSummary);
  const limits = firestoreSummary?.limitsDaily || {};

  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: "日本語で簡潔に2-4行。Markdown引用(>)前提なので本文だけ返す。最優先は『制限枠に収まるか』(超過リスク/余裕)。Firebaseは日毎free-tier使用率(R/W/D)を最優先に、過去14日変化も日次使用率ベースで言及。生件数の today vs 14d max 比率は制限判定の主根拠にしない。Codexは1w remainingを主軸に使用率(used%)も書き、5h remaining/使用率にも触れる。加えてCodex 1wは週枠なので、現在の曜日と週次リセットまであと何日(何時間)かの視点で余裕/注意を述べる。FirebaseとCodexの比較観点として『使用率』を使う。"
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            firestore: {
              focus: "free-tier usage rate",
              latestDateUTC: fsTrend.latest?.date || null,
              limitsDaily: {
                read: Number(limits.read || 0),
                write: Number(limits.write || 0),
                delete: Number(limits.delete || 0)
              },
              todayRatePercentOfFreeTier: fsToday.ratePercent,
              dailyRate14d: {
                latest: {
                  read: Number(fsTrend.trend.read.latestRate.toFixed(3)),
                  write: Number(fsTrend.trend.write.latestRate.toFixed(3)),
                  delete: Number(fsTrend.trend.delete.latestRate.toFixed(3))
                },
                latestVsPrevDelta: {
                  read: Number(fsTrend.trend.read.deltaRateDay.toFixed(3)),
                  write: Number(fsTrend.trend.write.deltaRateDay.toFixed(3)),
                  delete: Number(fsTrend.trend.delete.deltaRateDay.toFixed(3))
                },
                avgFirst7: {
                  read: Number(fsTrend.trend.read.avgRateFirst7.toFixed(3)),
                  write: Number(fsTrend.trend.write.avgRateFirst7.toFixed(3)),
                  delete: Number(fsTrend.trend.delete.avgRateFirst7.toFixed(3))
                },
                avgLast7: {
                  read: Number(fsTrend.trend.read.avgRateLast7.toFixed(3)),
                  write: Number(fsTrend.trend.write.avgRateLast7.toFixed(3)),
                  delete: Number(fsTrend.trend.delete.avgRateLast7.toFixed(3))
                },
                avgDeltaLast7MinusFirst7: {
                  read: Number(fsTrend.trend.read.deltaAvgRate.toFixed(3)),
                  write: Number(fsTrend.trend.write.deltaAvgRate.toFixed(3)),
                  delete: Number(fsTrend.trend.delete.deltaAvgRate.toFixed(3))
                },
                max14d: {
                  read: Number(fsTrend.trend.read.maxRate14d.toFixed(3)),
                  write: Number(fsTrend.trend.write.maxRate14d.toFixed(3)),
                  delete: Number(fsTrend.trend.delete.maxRate14d.toFixed(3))
                }
              },
              avgDeltaLast7MinusFirst7: {
                read: Number(fsTrend.trend.read.deltaAvg.toFixed(2)),
                write: Number(fsTrend.trend.write.deltaAvg.toFixed(2)),
                delete: Number(fsTrend.trend.delete.deltaAvg.toFixed(2))
              },
              latestVsPrevDayDelta: {
                read: fsTrend.trend.read.deltaDay,
                write: fsTrend.trend.write.deltaDay,
                delete: fsTrend.trend.delete.deltaDay
              }
            },
            codex: {
              focus: "usage rate aligned with firebase",
              planType: codexSummary?.planType || null,
              weeklyTiming: codexWeeklyTiming,
              weekly: {
                usedPercent: Number(codexSecondary?.usedPercent ?? 0),
                remainingPercent: Number(codexSecondary?.remainingPercent ?? 0),
                resetAtISO: codexSecondary?.resetAtISO || null
              },
              fiveHour: {
                usedPercent: Number(codexPrimary?.usedPercent ?? 0),
                remainingPercent: Number(codexPrimary?.remainingPercent ?? 0),
                resetAtISO: codexPrimary?.resetAtISO || null
              }
            }
          }, null, 2)
        }
      ]
    }
  ];

  const res = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input,
      max_output_tokens: 220
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error?.message || `OpenAI API error (${res.status})`;
    throw new Error(message);
  }
  const summary = extractOpenAIResponseText(payload);
  if (!summary) throw new Error("OpenAI response did not contain summary text.");
  return { summary, model: "gpt-4o-mini" };
}

async function summarizeMemoWithOpenAI({ threadTitle, memoBody }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  const title = String(threadTitle || "").trim();
  const body = String(memoBody || "").trim();
  if (!body) throw new Error("memoBody is required.");
  const clipped = body.slice(0, 20000);

  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: "You summarize memo text in Japanese. Be concise, concrete, and readable. Output 3-6 lines max. No preamble."
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            title ? `Thread: ${title}` : "",
            "Memo body:",
            clipped
          ].filter(Boolean).join("\n\n")
        }
      ]
    }
  ];

  const res = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-nano",
      input,
      max_output_tokens: 220
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error?.message || `OpenAI API error (${res.status})`;
    throw new Error(message);
  }
  const summary = extractOpenAIResponseText(payload);
  if (!summary) {
    throw new Error("OpenAI response did not contain summary text.");
  }
  return { summary, model: "gpt-4.1-nano" };
}

async function main() {
  const db = initFirestore();
  if (runtimeConfig.allowedAdapters.includes("firebase") && !process.env.CODEX_MEMO_FIREBASE_BUCKET) {
    throw new Error("CODEX_MEMO_FIREBASE_BUCKET is not set.");
  }
  const adapterRegistry = createAdapterRegistry({
    firebase: {
      db,
      collection: COLLECTION,
      admin,
      bucketName: process.env.CODEX_MEMO_FIREBASE_BUCKET || ""
    }
  });
  const memoService = createMemoService({
    db,
    collection: COLLECTION,
    runtimeConfig,
    adapterRegistry,
    admin,
    toMemoDto
  });
  const app = express();

  app.use(express.json({ limit: "15mb" }));
  app.use(express.static(path.join(__dirname, "..", "codex-memo-web", "public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/runtime-config", (_req, res) => {
    res.json({
      ...runtimeConfig,
      adapterDetails: getAdapterRuntimeDetails(adapterRegistry)
    });
  });

  app.get("/api/memos", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const projectName = String(req.query.projectName || "").trim().toLowerCase();
      const memoType = String(req.query.memoType || "").trim().toLowerCase();
      const storageKind = String(req.query.storageKind || "").trim().toLowerCase();
      const q = String(req.query.q || "").trim().toLowerCase();
      const noCache = String(req.query.nocache || "").trim() === "1";
      const cacheKey = `list:${JSON.stringify({ limit, projectName, memoType, storageKind, q, allowedAdapters: runtimeConfig.allowedAdapters })}`;
      if (!noCache) {
        const cached = getCache(cacheKey);
        if (cached) {
          res.setHeader("X-Cache", "HIT");
          res.json(cached);
          return;
        }
      }

      let memos = await memoService.listMemos(limit);

      if (projectName) {
        memos = memos.filter((memo) => memo.projectName.toLowerCase().includes(projectName));
      }
      if (memoType) {
        memos = memos.filter((memo) => memo.memoType.toLowerCase() === memoType);
      }
      if (storageKind) {
        memos = memos.filter((memo) => memo.storageKind.toLowerCase() === storageKind);
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

      memos.sort((a, b) => {
        const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        if (pinDiff !== 0) return pinDiff;
        const ta = new Date(a.updatedAtISO || a.datetimeISO || a.createdAtISO || 0).getTime();
        const tb = new Date(b.updatedAtISO || b.datetimeISO || b.createdAtISO || 0).getTime();
        return tb - ta;
      });

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

      const item = await memoService.getMemo(req.params.id);
      if (!item) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }
      const payload = { item };
      setCache(cacheKey, payload);
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to fetch memo." });
    }
  });

  app.post("/api/memos", async (req, res) => {
    try {
      const payload = {
        projectName: normalizeString(req.body.projectName, "projectName"),
        memoType: normalizeMemoType(req.body.memoType),
        memoBody: normalizeString(req.body.memoBody, "memoBody"),
        threadTitle: normalizeString(req.body.threadTitle, "threadTitle"),
        deletable: normalizeBool(req.body.deletable, false),
        pinned: normalizeBool(req.body.pinned, false),
        storageKind: req.body.storageKind,
        attachments: normalizeAttachmentsInput(req.body.attachments),
        createdBy: req.body.createdBy || "codex-memo-web",
        sourceThread: req.body.sourceThread || process.cwd()
      };
      assertExclusiveFlags(payload.pinned, payload.deletable);
      const created = await memoService.createMemo(payload);
      clearCache();
      res.status(201).json({ item: created });
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
        storageKind: req.body.storageKind,
        attachments: req.body.attachments === undefined ? undefined : normalizeAttachmentsInput(req.body.attachments)
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

      const updated = await memoService.updateMemo(req.params.id, patch);
      clearCache();
      res.json({ item: updated });
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
      memoService.assertAllowedStorageKind(normalizeStorageKind(current.storageKind, "firebase"));
      const confirmToken = req.get("x-codex-delete-confirm") || req.query.confirm;
      assertDeleteAllowed(current, confirmToken);
      await memoService.deleteMemo(req.params.id);
      clearCache();
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to delete memo." });
    }
  });

  app.get("/api/memos/:id/attachments/:attachmentId", async (req, res) => {
    try {
      const memo = await memoService.getMemo(req.params.id);
      if (!memo) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }
      const attachment = (memo.attachments || []).find((item) => item.id === req.params.attachmentId);
      if (!attachment) {
        res.status(404).json({ error: "Attachment not found." });
        return;
      }

      const adapter = adapterRegistry.getAdapter(memo.storageKind);
      const resolved = await adapter.resolveAttachmentUrl({
        memoId: memo.id,
        attachmentId: attachment.id,
        attachment
      });
      if (!resolved) {
        res.status(404).json({ error: "Attachment file not found." });
        return;
      }
      if (/^https?:\/\//i.test(resolved)) {
        res.redirect(resolved);
        return;
      }
      if (!path.isAbsolute(resolved) || !fs.existsSync(resolved)) {
        res.status(404).json({ error: "Attachment file not found." });
        return;
      }

      if (attachment.mimeType) {
        res.type(attachment.mimeType);
      }
      res.sendFile(resolved);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to load attachment." });
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
      memoService.assertAllowedStorageKind(normalizeStorageKind(current.storageKind, "firebase"));
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
      memoService.assertAllowedStorageKind(normalizeStorageKind(current.storageKind, "firebase"));
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

      const memo = await memoService.getMemo(req.params.id);
      if (!memo) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }
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

  app.post("/api/open-local", async (req, res) => {
    try {
      const { requestedPath, normalizedPath } = normalizeOpenPath(req.body.path);
      const targetPath = normalizedPath;
      openPathWithDefaultApp(targetPath);
      res.json({ ok: true, path: requestedPath, openedPath: targetPath });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to open local file." });
    }
  });

  app.post("/api/summarize", async (req, res) => {
    try {
      const memoBody = String(req.body?.memoBody || "").trim();
      const threadTitle = String(req.body?.threadTitle || "").trim();
      if (!memoBody) {
        res.status(400).json({ error: "memoBody is required." });
        return;
      }
      const result = await summarizeMemoWithOpenAI({ threadTitle, memoBody });
      res.json(result);
    } catch (error) {
      const message = error.message || "Failed to summarize memo.";
      const code = String(message).includes("OPENAI_API_KEY") ? 503 : 500;
      res.status(code).json({ error: message });
    }
  });

  app.post("/api/usage/overview-summary", async (req, res) => {
    try {
      const firestoreSummary = req.body?.firestoreSummary || null;
      const codexSummary = req.body?.codexSummary || null;
      if (!firestoreSummary || !codexSummary) {
        res.status(400).json({ error: "firestoreSummary and codexSummary are required." });
        return;
      }
      const result = await summarizeUsageOverviewWithOpenAI({ firestoreSummary, codexSummary });
      res.json(result);
    } catch (error) {
      const message = error.message || "Failed to summarize usage overview.";
      const code = String(message).includes("OPENAI_API_KEY") ? 503 : 500;
      res.status(code).json({ error: message });
    }
  });

  app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "codex-memo-web", "public", "index.html"));
  });

  app.listen(PORT, () => {
    const modeText = runtimeConfig.storageMode === "fixed"
      ? `fixed:${runtimeConfig.fixedAdapter}`
      : "mixed";
    console.log(`codex-memo web app running: http://localhost:${PORT} [${modeText}]`);
  });
}

main().catch((error) => {
  console.error("Failed to start codex-memo web app:", error.message);
  process.exit(1);
});
