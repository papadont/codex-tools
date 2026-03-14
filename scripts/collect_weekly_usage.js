#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { GoogleAuth } = require("google-auth-library");
const { loadEnvFromCandidates } = require("./load_env");

const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_COSTS_ENDPOINT = "https://api.openai.com/v1/organization/costs";
const OUT_DIR = path.join(process.cwd(), "dist", "usage-reports", "weekly");
const DEFAULT_FIRESTORE_HOURS = Number(process.env.WEEKLY_USAGE_HOURS || 24 * 14);
const DEFAULT_STORAGE_WINDOW_HOURS = 24 * 30;
const DEFAULT_OPENAI_WINDOW_DAYS = 30;

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

const STORAGE_TOTAL_BYTES_CANDIDATES = [
  "storage.googleapis.com/storage/v2/total_bytes",
  "storage.googleapis.com/storage/total_bytes"
];

const STORAGE_OBJECT_COUNT_CANDIDATES = [
  "storage.googleapis.com/storage/v2/total_count",
  "storage.googleapis.com/storage/total_count"
];

const STORAGE_EGRESS_BYTES_CANDIDATES = [
  "storage.googleapis.com/network/sent_bytes_count"
];

const STORAGE_REQUEST_COUNT_CANDIDATES = [
  "storage.googleapis.com/api/request_count"
];

const DEFAULT_BUDGET_JPY = Number(process.env.USAGE_SOFT_BUDGET_JPY || 5000);

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

function usdRound(value, digits = 4) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : 0;
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

function buildBucketMonitoringFilter(metricType, bucketName) {
  const safeBucket = String(bucketName || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `metric.type="${metricType}" AND resource.labels.bucket_name="${safeBucket}"`;
}

async function getMonitoringAccessContext() {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/monitoring.read"] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
  if (!accessToken) throw new Error("Failed to get Monitoring access token.");
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || await auth.getProjectId();
  if (!projectId) throw new Error("Project ID could not be resolved for Monitoring.");
  return { accessToken, projectId };
}

async function listMonitoringTimeSeries({
  accessToken,
  projectId,
  filter,
  startTime,
  endTime,
  aggregation = {},
  pageToken = ""
}) {
  const qs = new URLSearchParams({
    filter,
    "interval.startTime": startTime,
    "interval.endTime": endTime,
    view: "FULL"
  });
  if (aggregation.alignmentPeriod) qs.set("aggregation.alignmentPeriod", aggregation.alignmentPeriod);
  if (aggregation.perSeriesAligner) qs.set("aggregation.perSeriesAligner", aggregation.perSeriesAligner);
  if (aggregation.crossSeriesReducer) qs.set("aggregation.crossSeriesReducer", aggregation.crossSeriesReducer);
  if (Array.isArray(aggregation.groupByFields) && aggregation.groupByFields.length) {
    for (const field of aggregation.groupByFields) qs.append("aggregation.groupByFields", field);
  }
  if (pageToken) qs.set("pageToken", pageToken);

  const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${qs.toString()}`;
  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`Monitoring API error (${res.status}): ${body}`);
    error.statusCode = res.status;
    throw error;
  }
  return res.json();
}

function isMetricNotFoundError(error) {
  return Number(error?.statusCode) === 404;
}

async function fetchMonitoringLatestGauge({
  accessToken,
  projectId,
  metricCandidates,
  bucketName
}) {
  const end = new Date();
  const start = new Date(end.getTime() - (48 * 60 * 60 * 1000));
  const startTime = start.toISOString();
  const endTime = end.toISOString();

  for (const metricType of metricCandidates) {
    let pageToken = "";
    let bestPoint = null;
    try {
      do {
        const payload = await listMonitoringTimeSeries({
          accessToken,
          projectId,
          filter: buildBucketMonitoringFilter(metricType, bucketName),
          startTime,
          endTime,
          aggregation: {
            alignmentPeriod: "3600s",
            perSeriesAligner: "ALIGN_NEXT_OLDER",
            crossSeriesReducer: "REDUCE_SUM"
          },
          pageToken
        });
        const series = Array.isArray(payload.timeSeries) ? payload.timeSeries : [];
        for (const item of series) {
          for (const point of Array.isArray(item.points) ? item.points : []) {
            const pointTime = String(point?.interval?.endTime || point?.interval?.startTime || "");
            if (!pointTime) continue;
            if (!bestPoint || pointTime > bestPoint.time) {
              bestPoint = { time: pointTime, value: toPointNumber(point) };
            }
          }
        }
        pageToken = payload.nextPageToken || "";
      } while (pageToken);
    } catch (error) {
      if (isMetricNotFoundError(error)) continue;
      throw error;
    }

    if (bestPoint) {
      return { metricType, value: bestPoint.value, sampledAtISO: bestPoint.time };
    }
  }

  return { metricType: metricCandidates[0], value: 0, sampledAtISO: endTime };
}

async function fetchMonitoringTotalOverWindow({
  accessToken,
  projectId,
  metricCandidates,
  bucketName,
  hours
}) {
  const end = new Date();
  const start = new Date(end.getTime() - (hours * 60 * 60 * 1000));
  const startTime = start.toISOString();
  const endTime = end.toISOString();

  for (const metricType of metricCandidates) {
    let total = 0;
    let points = 0;
    let pageToken = "";
    try {
      do {
        const payload = await listMonitoringTimeSeries({
          accessToken,
          projectId,
          filter: buildBucketMonitoringFilter(metricType, bucketName),
          startTime,
          endTime,
          aggregation: {
            alignmentPeriod: "86400s",
            perSeriesAligner: "ALIGN_SUM",
            crossSeriesReducer: "REDUCE_SUM"
          },
          pageToken
        });
        const series = Array.isArray(payload.timeSeries) ? payload.timeSeries : [];
        for (const item of series) {
          for (const point of Array.isArray(item.points) ? item.points : []) {
            total += toPointNumber(point);
            points += 1;
          }
        }
        pageToken = payload.nextPageToken || "";
      } while (pageToken);
    } catch (error) {
      if (isMetricNotFoundError(error)) continue;
      throw error;
    }
    if (points > 0 || total > 0) return { metricType, total, startTime, endTime };
  }

  return { metricType: metricCandidates[0], total: 0, startTime, endTime };
}

function classifyStorageRequestMethod(method) {
  const name = String(method || "").toLowerCase();
  if (!name) return "other";
  if (/(write|create|delete|compose|rewrite|insert|patch|update|list)/.test(name)) return "classA";
  if (/(read|get|stat|metadata)/.test(name)) return "classB";
  return "other";
}

async function fetchStorageRequestBreakdown({
  accessToken,
  projectId,
  bucketName,
  hours
}) {
  const end = new Date();
  const start = new Date(end.getTime() - (hours * 60 * 60 * 1000));
  const startTime = start.toISOString();
  const endTime = end.toISOString();

  for (const metricType of STORAGE_REQUEST_COUNT_CANDIDATES) {
    let pageToken = "";
    const totals = { classA: 0, classB: 0, other: 0, total: 0 };

    try {
      do {
        const payload = await listMonitoringTimeSeries({
          accessToken,
          projectId,
          filter: buildBucketMonitoringFilter(metricType, bucketName),
          startTime,
          endTime,
          aggregation: {
            alignmentPeriod: "86400s",
            perSeriesAligner: "ALIGN_SUM",
            crossSeriesReducer: "REDUCE_SUM",
            groupByFields: ["metric.labels.method"]
          },
          pageToken
        });
        const series = Array.isArray(payload.timeSeries) ? payload.timeSeries : [];
        for (const item of series) {
          const kind = classifyStorageRequestMethod(item?.metric?.labels?.method || "");
          for (const point of Array.isArray(item.points) ? item.points : []) {
            const value = toPointNumber(point);
            totals[kind] += value;
            totals.total += value;
          }
        }
        pageToken = payload.nextPageToken || "";
      } while (pageToken);
    } catch (error) {
      if (isMetricNotFoundError(error)) continue;
      throw error;
    }

    if (totals.total > 0) return { metricType, totals, startTime, endTime };
  }

  return {
    metricType: STORAGE_REQUEST_COUNT_CANDIDATES[0],
    totals: { classA: 0, classB: 0, other: 0, total: 0 },
    startTime,
    endTime
  };
}

function normalizeBucketName(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value.replace(/^gs:\/\//, "").replace(/\/+$/, "");
}

function storageQuotaProfile(bucketName) {
  if (/\.firebasestorage\.app$/i.test(bucketName)) {
    return {
      bucketKind: "firebasestorage.app",
      noCost: {
        storageGbMonths: 5,
        downloadGbPerMonth: 100,
        classAOpsPerMonth: 5_000,
        classBOpsPerMonth: 50_000
      },
      pricingAssumption: {
        storageUsdPerGbMonth: 0.02,
        downloadUsdPerGb: 0.12,
        classAUsdPer1k: 0.005,
        classBUsdPer1k: 0.0004
      },
      note: "Firebase default bucket (firebasestorage.app) no-cost usage profile."
    };
  }
  return {
    bucketKind: /\.appspot\.com$/i.test(bucketName) ? "appspot.com" : "custom",
    noCost: {
      storageGbMonths: 5,
      downloadGbPerDay: 1,
      uploadOpsPerDay: 20_000,
      downloadOpsPerDay: 50_000
    },
    pricingAssumption: {
      storageUsdPerGbMonth: 0.02,
      downloadUsdPerGb: 0.12,
      classAUsdPer1k: 0.005,
      classBUsdPer1k: 0.0004
    },
    note: "Legacy/default bucket profile. Download/request free quota is daily."
  };
}

function buildStorageEstimate({ profile, currentTotalBytes, last30dEgressBytes, requestTotals }) {
  const storageGb = Number(currentTotalBytes || 0) / (1024 ** 3);
  const egressGb = Number(last30dEgressBytes || 0) / (1024 ** 3);
  const classA = Number(requestTotals?.classA || 0);
  const classB = Number(requestTotals?.classB || 0);
  const free = profile.noCost || {};
  const pricing = profile.pricingAssumption || {};
  const billableStorageGb = Math.max(0, storageGb - Number(free.storageGbMonths || 0));
  const billableEgressGb = Math.max(0, egressGb - Number(free.downloadGbPerMonth || 0));
  const billableClassA = Math.max(0, classA - Number(free.classAOpsPerMonth || 0));
  const billableClassB = Math.max(0, classB - Number(free.classBOpsPerMonth || 0));
  const estimatedMonthlyUsd = usdRound(
    (billableStorageGb * Number(pricing.storageUsdPerGbMonth || 0))
      + (billableEgressGb * Number(pricing.downloadUsdPerGb || 0))
      + ((billableClassA / 1000) * Number(pricing.classAUsdPer1k || 0))
      + ((billableClassB / 1000) * Number(pricing.classBUsdPer1k || 0))
  );

  return {
    storageGb,
    egressGb,
    billableStorageGb,
    billableEgressGb,
    billableClassA,
    billableClassB,
    estimatedMonthlyUsd,
    percentOfNoCost: {
      storage: percentOf(storageGb, Number(free.storageGbMonths || 0)),
      download: percentOf(egressGb, Number(free.downloadGbPerMonth || 0)),
      classA: percentOf(classA, Number(free.classAOpsPerMonth || 0)),
      classB: percentOf(classB, Number(free.classBOpsPerMonth || 0))
    }
  };
}

async function getStorageUsagePayload() {
  requireCredentials();
  const bucketName = normalizeBucketName(process.env.CODEX_MEMO_FIREBASE_BUCKET);
  if (!bucketName) throw new Error("CODEX_MEMO_FIREBASE_BUCKET is not set.");

  const profile = storageQuotaProfile(bucketName);
  const { accessToken, projectId } = await getMonitoringAccessContext();
  const [currentBytes, objectCount, egress30d, requests30d] = await Promise.all([
    fetchMonitoringLatestGauge({ accessToken, projectId, metricCandidates: STORAGE_TOTAL_BYTES_CANDIDATES, bucketName }),
    fetchMonitoringLatestGauge({ accessToken, projectId, metricCandidates: STORAGE_OBJECT_COUNT_CANDIDATES, bucketName }),
    fetchMonitoringTotalOverWindow({
      accessToken,
      projectId,
      metricCandidates: STORAGE_EGRESS_BYTES_CANDIDATES,
      bucketName,
      hours: DEFAULT_STORAGE_WINDOW_HOURS
    }),
    fetchStorageRequestBreakdown({ accessToken, projectId, bucketName, hours: DEFAULT_STORAGE_WINDOW_HOURS })
  ]);

  const estimate = buildStorageEstimate({
    profile,
    currentTotalBytes: currentBytes.value,
    last30dEgressBytes: egress30d.total,
    requestTotals: requests30d.totals
  });

  return {
    fetchedAtISO: new Date().toISOString(),
    projectId,
    bucketName,
    bucketKind: profile.bucketKind,
    noCost: profile.noCost,
    note: profile.note,
    pricingAssumption: {
      ...profile.pricingAssumption,
      currency: "USD",
      inferred: true
    },
    current: {
      totalBytes: Number(currentBytes.value || 0),
      totalObjects: Number(objectCount.value || 0),
      sampledAtISO: currentBytes.sampledAtISO || objectCount.sampledAtISO || new Date().toISOString(),
      metricTypes: {
        totalBytes: currentBytes.metricType,
        totalObjects: objectCount.metricType
      }
    },
    last30d: {
      startTime: egress30d.startTime,
      endTime: egress30d.endTime,
      egressBytes: Number(egress30d.total || 0),
      requestCounts: requests30d.totals,
      metricTypes: {
        egressBytes: egress30d.metricType,
        requestCount: requests30d.metricType
      }
    },
    estimate
  };
}

function parseOpenAICostBuckets(payload) {
  const buckets = Array.isArray(payload?.data) ? payload.data : [];
  const daily = [];
  let totalUsd = 0;
  for (const bucket of buckets) {
    const rows = Array.isArray(bucket?.results) ? bucket.results : [];
    let amount = 0;
    let currency = "usd";
    const lineItemTotals = new Map();
    for (const row of rows) {
      const value = Number(row?.amount?.value || 0);
      if (Number.isFinite(value)) amount += value;
      if (row?.amount?.currency) currency = String(row.amount.currency).toLowerCase();
      const lineItem = String(row?.line_item || "other").trim() || "other";
      lineItemTotals.set(lineItem, usdRound(Number(lineItemTotals.get(lineItem) || 0) + (Number.isFinite(value) ? value : 0), 6));
    }
    totalUsd += amount;
    const lineItems = Array.from(lineItemTotals.entries())
      .map(([name, amountUsd]) => ({ name, amountUsd: usdRound(amountUsd, 6), currency }))
      .filter((item) => item.amountUsd > 0)
      .sort((a, b) => b.amountUsd - a.amountUsd || a.name.localeCompare(b.name));
    daily.push({
      startTime: Number(bucket?.start_time || 0),
      endTime: Number(bucket?.end_time || 0),
      amountUsd: usdRound(amount, 6),
      currency,
      lineItems
    });
  }
  daily.sort((a, b) => a.startTime - b.startTime);
  return { totalUsd: usdRound(totalUsd, 6), daily };
}

async function getOpenAICostsPayload() {
  const adminKey = String(process.env.OPENAI_ADMIN_KEY || "").trim();
  if (!adminKey) {
    return {
      fetchedAtISO: new Date().toISOString(),
      available: false,
      reason: "OPENAI_ADMIN_KEY is not set."
    };
  }

  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - (DEFAULT_OPENAI_WINDOW_DAYS * 24 * 60 * 60);
  const qs = new URLSearchParams({
    start_time: String(startTime),
    end_time: String(endTime),
    bucket_width: "1d",
    limit: String(DEFAULT_OPENAI_WINDOW_DAYS + 1)
  });
  qs.append("group_by", "line_item");
  const res = await fetch(`${OPENAI_COSTS_ENDPOINT}?${qs.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${adminKey}` }
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error?.message || `OpenAI costs API error (${res.status})`;
    throw new Error(message);
  }

  const parsed = parseOpenAICostBuckets(payload);
  const latestDay = parsed.daily[parsed.daily.length - 1] || null;
  const last14Daily = parsed.daily.slice(-14);
  const lineItems14dMap = new Map();
  let totalUsd14d = 0;
  for (const day of last14Daily) {
    totalUsd14d += Number(day?.amountUsd || 0);
    for (const item of Array.isArray(day?.lineItems) ? day.lineItems : []) {
      const name = String(item?.name || "other").trim() || "other";
      const amountUsd = Number(item?.amountUsd || 0);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;
      lineItems14dMap.set(name, usdRound(Number(lineItems14dMap.get(name) || 0) + amountUsd, 6));
    }
  }

  const lineItems14d = Array.from(lineItems14dMap.entries())
    .map(([name, amountUsd]) => ({ name, amountUsd: usdRound(amountUsd, 6), currency: "usd" }))
    .filter((item) => item.amountUsd > 0)
    .sort((a, b) => b.amountUsd - a.amountUsd || a.name.localeCompare(b.name));

  return {
    fetchedAtISO: new Date().toISOString(),
    available: true,
    windowDays: DEFAULT_OPENAI_WINDOW_DAYS,
    windowDaysRecent: 14,
    startTime,
    endTime,
    totalUsd30d: parsed.totalUsd,
    totalUsd14d: usdRound(totalUsd14d, 6),
    latestDayUsd: latestDay ? latestDay.amountUsd : 0,
    lineItems14d,
    daily: parsed.daily,
    budgetReference: {
      amountJpy: DEFAULT_BUDGET_JPY
    }
  };
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

  const [firestoreUsage, codexUsage, storageUsage, openaiCosts] = await Promise.all([
    getFirestoreUsagePayload({ hours: firestoreHours }),
    getCodexUsagePayload(),
    getStorageUsagePayload(),
    getOpenAICostsPayload()
  ]);

  const payload = {
    snapshotAtISO: snapshotAt,
    source: "codex-memo usage tile compatible",
    firestoreUsage,
    codexUsage,
    storageUsage,
    openaiCosts
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
