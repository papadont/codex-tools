#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { GoogleAuth } = require("google-auth-library");
const { loadEnvFromCandidates } = require("./load_env");

const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const OUT_DIR = path.join(process.cwd(), "dist", "usage-reports", "weekly");
const DEFAULT_FIRESTORE_HOURS = Number(process.env.WEEKLY_USAGE_HOURS || 24 * 14);

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

loadEnvFromCandidates();

function requireCredentials() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  }
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
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const days = [];
  const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (current <= endDay) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

async function fetchMonitoringDailyTotals({ projectId, metricType, startTime, endTime }) {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/monitoring.read"] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
  if (!accessToken) throw new Error("Failed to get Monitoring access token.");

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
    const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });

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

async function fetchBestUsageMetric({ projectId, startTime, endTime, candidates }) {
  let last = null;
  for (const metricType of candidates) {
    const result = await fetchMonitoringDailyTotals({ projectId, metricType, startTime, endTime });
    last = result;
    let total = 0;
    for (const value of result.daily.values()) total += value;
    if (result.points > 0 || total > 0) return result;
  }
  return last || { metricType: candidates[0], daily: new Map(), points: 0 };
}

async function getFirestoreUsagePayload({ hours }) {
  requireCredentials();
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/monitoring.read"] });
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || await auth.getProjectId();
  if (!projectId) throw new Error("Project ID could not be resolved for Monitoring.");

  const end = new Date();
  const start = new Date(end.getTime() - (hours * 60 * 60 * 1000));
  const startTime = start.toISOString();
  const endTime = end.toISOString();
  const days = buildDateList(startTime, endTime);

  const [read, write, del] = await Promise.all([
    fetchBestUsageMetric({ projectId, startTime, endTime, candidates: USAGE_METRIC_CANDIDATES.read }),
    fetchBestUsageMetric({ projectId, startTime, endTime, candidates: USAGE_METRIC_CANDIDATES.write }),
    fetchBestUsageMetric({ projectId, startTime, endTime, candidates: USAGE_METRIC_CANDIDATES.delete })
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
  if (!authPath || !fs.existsSync(authPath)) throw new Error("Codex auth.json not found.");
  const raw = fs.readFileSync(authPath, "utf8");
  const json = JSON.parse(raw);
  const token = json?.tokens?.access_token;
  if (!token || typeof token !== "string") throw new Error("Codex access token is missing in auth.json.");
  return token;
}

async function getCodexUsagePayload() {
  const token = getCodexAccessToken();
  const res = await fetch(CODEX_USAGE_ENDPOINT, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail || body?.error || `Codex usage API error (${res.status})`);

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

function toSafeFilePart(iso) {
  return iso.replace(/[:.]/g, "-");
}

function computeNextTriggerISO(resetAtISO) {
  const resetMs = new Date(resetAtISO).getTime();
  if (!Number.isFinite(resetMs)) return "";
  let triggerMs = resetMs - (10 * 60 * 1000);
  const nowMs = Date.now();
  while (triggerMs <= nowMs) {
    triggerMs += 7 * 24 * 60 * 60 * 1000;
  }
  return new Date(triggerMs).toISOString();
}

function installOnceTrigger(triggerAtISO) {
  if (!triggerAtISO) return;
  const scriptPath = path.join(process.cwd(), "scripts", "install_usage_memo_once_launchagent.sh");
  execFileSync(scriptPath, [triggerAtISO], { stdio: "inherit" });
}

async function main() {
  const snapshotAt = new Date().toISOString();
  const firestoreHours = Number.isFinite(DEFAULT_FIRESTORE_HOURS) && DEFAULT_FIRESTORE_HOURS > 0
    ? DEFAULT_FIRESTORE_HOURS
    : 24 * 14;

  const [firestoreUsage, codexUsage] = await Promise.all([
    getFirestoreUsagePayload({ hours: firestoreHours }),
    getCodexUsagePayload()
  ]);

  const payload = {
    snapshotAtISO: snapshotAt,
    source: "codex-memo usage tile compatible",
    firestoreUsage,
    codexUsage
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filename = `${toSafeFilePart(snapshotAt)}.json`;
  const outputPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "latest.json"), JSON.stringify(payload, null, 2));

  const weeklyResetAtISO = codexUsage?.secondaryWindow?.resetAtISO || "";
  const triggerAtISO = computeNextTriggerISO(weeklyResetAtISO);
  if (triggerAtISO) {
    installOnceTrigger(triggerAtISO);
  } else {
    console.warn("Skip installing one-shot trigger: weekly resetAtISO is unavailable.");
  }

  console.log(`Saved weekly usage snapshot: ${outputPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
