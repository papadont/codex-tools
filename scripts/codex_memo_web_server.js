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
const {
  createMemoResponseCache,
  loadThroughMemoResponseCache
} = require("./memo_response_cache");
const { normalizeAttachments } = require("./memo_sync_service");
const { normalizeStorageKind, resolveRuntimeConfig } = require("./runtime_config");
const UsageOverviewShared = require("../codex-memo-web/public/usage_overview_shared");

loadEnvFromCandidates();

const PORT = Number(process.env.PORT || 4173);
const COLLECTION = "codex-memo";
const ALLOWED_MEMO_TYPES = new Set(["handover memo", "memo", "propomemo", "keep"]);
const LEGACY_MEMO_CACHE_TTL_MS = process.env.MEMO_CACHE_TTL_MS;
const MEMO_LIST_CACHE_TTL_MS = Number(
  process.env.MEMO_LIST_CACHE_TTL_MS || LEGACY_MEMO_CACHE_TTL_MS || 10 * 60_000
);
const MEMO_DETAIL_CACHE_TTL_MS = Number(
  process.env.MEMO_DETAIL_CACHE_TTL_MS || LEGACY_MEMO_CACHE_TTL_MS || 24 * 60 * 60_000
);
const MEMO_COUNT_CACHE_TTL_MS = Number(
  process.env.MEMO_COUNT_CACHE_TTL_MS || LEGACY_MEMO_CACHE_TTL_MS || 10 * 60_000
);
const MEMO_ATTACHMENT_CACHE_TTL_MS = Number(
  process.env.MEMO_ATTACHMENT_CACHE_TTL_MS || LEGACY_MEMO_CACHE_TTL_MS || 10 * 60_000
);
const USAGE_CACHE_TTL_MS = Number(process.env.USAGE_CACHE_TTL_MS || 180_000);
const CODEX_USAGE_CACHE_TTL_MS = Number(process.env.CODEX_USAGE_CACHE_TTL_MS || 30_000);
const STORAGE_USAGE_CACHE_TTL_MS = Number(process.env.STORAGE_USAGE_CACHE_TTL_MS || 180_000);
const OPENAI_COSTS_CACHE_TTL_MS = Number(process.env.OPENAI_COSTS_CACHE_TTL_MS || 180_000);
const CODEX_USAGE_V2_ENDPOINT =
  process.env.CODEX_USAGE_V2_ENDPOINT || "https://chatgpt.com/backend-api/api/codex/usage";
const CODEX_USAGE_LEGACY_ENDPOINT =
  process.env.CODEX_USAGE_ENDPOINT || "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const GEMINI_GENERATE_CONTENT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_COSTS_ENDPOINT = "https://api.openai.com/v1/organization/costs";
const DEFAULT_BUDGET_JPY = Number(process.env.USAGE_SOFT_BUDGET_JPY || 5000);

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

const cacheStore = createMemoResponseCache();
const runtimeConfig = resolveRuntimeConfig(process.argv.slice(2), process.env);

function getCache(key) {
  return cacheStore.get(key);
}

function setCache(key, value, ttlMs = MEMO_LIST_CACHE_TTL_MS) {
  cacheStore.set(key, value, ttlMs);
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

function usdRound(value, digits = 4) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : 0;
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

function buildBucketMonitoringFilter(metricType, bucketName) {
  const safeBucket = String(bucketName || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `metric.type="${metricType}" AND resource.labels.bucket_name="${safeBucket}"`;
}

async function getMonitoringAccessContext() {
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/monitoring.read"]
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
  if (!accessToken) {
    throw new Error("Failed to get Monitoring access token.");
  }
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || await auth.getProjectId();
  if (!projectId) {
    throw new Error("Project ID could not be resolved for Monitoring.");
  }
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
    for (const field of aggregation.groupByFields) {
      qs.append("aggregation.groupByFields", field);
    }
  }
  if (pageToken) qs.set("pageToken", pageToken);

  const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${qs.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`Monitoring API error (${res.status}): ${body}`);
    error.statusCode = res.status;
    error.responseBody = body;
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
              bestPoint = {
                time: pointTime,
                value: toPointNumber(point)
              };
            }
          }
        }
        pageToken = payload.nextPageToken || "";
      } while (pageToken);
    } catch (error) {
      if (isMetricNotFoundError(error)) {
        continue;
      }
      throw error;
    }

    if (bestPoint) {
      return {
        metricType,
        value: bestPoint.value,
        sampledAtISO: bestPoint.time
      };
    }
  }

  return {
    metricType: metricCandidates[0],
    value: 0,
    sampledAtISO: endTime
  };
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
      if (isMetricNotFoundError(error)) {
        continue;
      }
      throw error;
    }
    if (points > 0 || total > 0) {
      return { metricType, total, startTime, endTime };
    }
  }

  return {
    metricType: metricCandidates[0],
    total: 0,
    startTime,
    endTime
  };
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
          const method = item?.metric?.labels?.method || "";
          const kind = classifyStorageRequestMethod(method);
          for (const point of Array.isArray(item.points) ? item.points : []) {
            const value = toPointNumber(point);
            totals[kind] += value;
            totals.total += value;
          }
        }
        pageToken = payload.nextPageToken || "";
      } while (pageToken);
    } catch (error) {
      if (isMetricNotFoundError(error)) {
        continue;
      }
      throw error;
    }

    if (totals.total > 0) {
      return { metricType, totals, startTime, endTime };
    }
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
  if (!bucketName) {
    throw new Error("CODEX_MEMO_FIREBASE_BUCKET is not set.");
  }

  const profile = storageQuotaProfile(bucketName);
  const { accessToken, projectId } = await getMonitoringAccessContext();
  const [currentBytes, objectCount, egress30d, requests30d] = await Promise.all([
    fetchMonitoringLatestGauge({
      accessToken,
      projectId,
      metricCandidates: STORAGE_TOTAL_BYTES_CANDIDATES,
      bucketName
    }),
    fetchMonitoringLatestGauge({
      accessToken,
      projectId,
      metricCandidates: STORAGE_OBJECT_COUNT_CANDIDATES,
      bucketName
    }),
    fetchMonitoringTotalOverWindow({
      accessToken,
      projectId,
      metricCandidates: STORAGE_EGRESS_BYTES_CANDIDATES,
      bucketName,
      hours: 24 * 30
    }),
    fetchStorageRequestBreakdown({
      accessToken,
      projectId,
      bucketName,
      hours: 24 * 30
    })
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
      .map(([name, amountUsd]) => ({
        name,
        amountUsd: usdRound(amountUsd, 6),
        currency
      }))
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
  return {
    totalUsd: usdRound(totalUsd, 6),
    daily
  };
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
  const startTime = endTime - (30 * 24 * 60 * 60);
  const qs = new URLSearchParams({
    start_time: String(startTime),
    end_time: String(endTime),
    bucket_width: "1d",
    limit: "31"
  });
  qs.append("group_by", "line_item");
  const res = await fetch(`${OPENAI_COSTS_ENDPOINT}?${qs.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${adminKey}`
    }
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
    const items = Array.isArray(day?.lineItems) ? day.lineItems : [];
    for (const item of items) {
      const name = String(item?.name || "other").trim() || "other";
      const amountUsd = Number(item?.amountUsd || 0);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;
      lineItems14dMap.set(name, usdRound(Number(lineItems14dMap.get(name) || 0) + amountUsd, 6));
    }
  }
  const lineItems14d = Array.from(lineItems14dMap.entries())
    .map(([name, amountUsd]) => ({
      name,
      amountUsd: usdRound(amountUsd, 6),
      currency: "usd"
    }))
    .filter((item) => item.amountUsd > 0)
    .sort((a, b) => b.amountUsd - a.amountUsd || a.name.localeCompare(b.name));
  return {
    fetchedAtISO: new Date().toISOString(),
    available: true,
    windowDays: 30,
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

function epochSecondsToISO(epochSeconds) {
  if (typeof epochSeconds === "string" && /\d{4}-\d{2}-\d{2}T/.test(epochSeconds)) {
    const ms = new Date(epochSeconds).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const n = Number(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 10_000_000_000 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function secondsUntil(resetAtISO, fetchedAtISO) {
  const resetMs = new Date(resetAtISO || "").getTime();
  const fetchedMs = new Date(fetchedAtISO || "").getTime();
  if (!Number.isFinite(resetMs) || !Number.isFinite(fetchedMs)) return 0;
  return Math.max(0, Math.round((resetMs - fetchedMs) / 1000));
}

function mapRateLimitWindow(window, fetchedAtISO = new Date().toISOString()) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = Number(
    window.used_percent ?? window.usedPercent ?? window.percentUsed ?? window.usagePercent ?? 0
  );
  const limitWindowSeconds = Number(
    window.limit_window_seconds ??
      window.limitWindowSeconds ??
      window.window_seconds ??
      (window.windowDurationMins == null ? 0 : Number(window.windowDurationMins) * 60)
  );
  const resetAtISO = epochSecondsToISO(
    window.reset_at ?? window.resetsAt ?? window.resetAt ?? window.reset_at_iso ?? window.resetAtISO
  );
  const resetAfterSeconds = Number(
    window.reset_after_seconds ?? window.resetAfterSeconds ?? secondsUntil(resetAtISO, fetchedAtISO)
  );
  return {
    usedPercent,
    remainingPercent: Number(
      window.remaining_percent ?? window.remainingPercent ?? Math.max(0, 100 - usedPercent)
    ),
    limitWindowSeconds,
    resetAfterSeconds,
    resetAtISO
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

async function fetchCodexJson(url, token) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    }
  });
  const raw = await res.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { error: `non-JSON response (${res.status})` };
  }
  if (!res.ok) {
    throw new Error(body?.detail || body?.error || `Codex usage API error (${res.status})`);
  }
  return body;
}

function normalizeCodexCredits(raw) {
  return {
    hasCredits: Boolean(raw?.has_credits ?? raw?.hasCredits),
    unlimited: Boolean(raw?.unlimited),
    balance: String(raw?.balance ?? "0"),
    approxLocalMessages: Array.isArray(raw?.approx_local_messages)
      ? raw.approx_local_messages
      : Array.isArray(raw?.approxLocalMessages)
        ? raw.approxLocalMessages
        : [0, 0],
    approxCloudMessages: Array.isArray(raw?.approx_cloud_messages)
      ? raw.approx_cloud_messages
      : Array.isArray(raw?.approxCloudMessages)
        ? raw.approxCloudMessages
        : [0, 0]
  };
}

function normalizeCodexLimitSnapshot(raw, fetchedAtISO) {
  if (!raw || typeof raw !== "object") return null;
  const primaryRaw =
    raw.primary || raw.primaryWindow || raw.primary_window || raw.rate_limit?.primary_window || null;
  const secondaryRaw =
    raw.secondary || raw.secondaryWindow || raw.secondary_window || raw.rate_limit?.secondary_window || null;
  return {
    limitId: raw.limitId ?? raw.limit_id ?? null,
    limitName: raw.limitName ?? raw.limit_name ?? null,
    planType: raw.planType ?? raw.plan_type ?? null,
    primaryWindow: mapRateLimitWindow(primaryRaw, fetchedAtISO),
    secondaryWindow: mapRateLimitWindow(secondaryRaw, fetchedAtISO),
    credits: normalizeCodexCredits(raw.credits || {}),
    individualLimit: raw.individualLimit || raw.individual_limit || null,
    rateLimitReachedType: raw.rateLimitReachedType ?? raw.rate_limit_reached_type ?? null
  };
}

function normalizeCodexDailyUsageBuckets(rawBuckets) {
  const buckets = Array.isArray(rawBuckets) ? rawBuckets : [];
  return buckets
    .map((bucket) => ({
      date: String(bucket?.startDate ?? bucket?.start_date ?? bucket?.date ?? "").slice(0, 10),
      tokens: Number(
        bucket?.tokens ?? bucket?.totalTokens ?? bucket?.total_tokens ?? bucket?.tokenCount ?? bucket?.token_count ?? 0
      )
    }))
    .filter((bucket) => bucket.date && Number.isFinite(bucket.tokens))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeCodexTokenUsage(raw) {
  const holder = raw?.accountTokenUsage || raw?.tokenUsage || raw?.usage || raw || {};
  const summary = holder.summary || raw?.summary || raw?.token_usage_summary || {};
  const dailyUsageBuckets = normalizeCodexDailyUsageBuckets(
    holder.dailyUsageBuckets || holder.daily_usage_buckets || raw?.dailyUsageBuckets || raw?.daily_usage_buckets
  );
  const hasSummary = summary && Object.keys(summary).length > 0;
  if (!hasSummary && dailyUsageBuckets.length === 0) return null;
  const maxDaily = dailyUsageBuckets.reduce((max, bucket) => Math.max(max, Number(bucket.tokens || 0)), 0);
  const sumDaily = dailyUsageBuckets.reduce((sum, bucket) => sum + Number(bucket.tokens || 0), 0);
  return {
    summary: {
      lifetimeTokens: Number(summary.lifetimeTokens ?? summary.lifetime_tokens ?? sumDaily ?? 0),
      peakDailyTokens: Number(summary.peakDailyTokens ?? summary.peak_daily_tokens ?? maxDaily ?? 0),
      longestRunningTurnSec: Number(summary.longestRunningTurnSec ?? summary.longest_running_turn_sec ?? 0),
      currentStreakDays: Number(summary.currentStreakDays ?? summary.current_streak_days ?? 0),
      longestStreakDays: Number(summary.longestStreakDays ?? summary.longest_streak_days ?? 0)
    },
    dailyUsageBuckets
  };
}

function pickPrimaryCodexLimit(body) {
  const byLimitId = body?.rateLimitsByLimitId || body?.rate_limits_by_limit_id || null;
  if (byLimitId && typeof byLimitId === "object") {
    if (byLimitId.codex) return byLimitId.codex;
    const entries = Object.values(byLimitId);
    const named = entries.find((entry) =>
      /codex/i.test(String(entry?.limitId || entry?.limit_id || entry?.limitName || entry?.limit_name || ""))
    );
    if (named) return named;
    if (entries.length) return entries[0];
  }
  const limits = body?.rateLimits || body?.rate_limits || null;
  if (Array.isArray(limits)) {
    return (
      limits.find((entry) =>
        /codex/i.test(String(entry?.limitId || entry?.limit_id || entry?.limitName || entry?.limit_name || ""))
      ) || limits[0] || null
    );
  }
  return body?.rateLimits || body?.rate_limits || body?.rate_limit || body;
}

function normalizeCodexUsageV2Payload(body, fetchedAtISO) {
  const rawLimit = pickPrimaryCodexLimit(body);
  const primaryLimit = normalizeCodexLimitSnapshot(rawLimit, fetchedAtISO);
  const byLimitId = body?.rateLimitsByLimitId || body?.rate_limits_by_limit_id || null;
  const additionalLimits = byLimitId && typeof byLimitId === "object"
    ? Object.values(byLimitId).map((limit) => normalizeCodexLimitSnapshot(limit, fetchedAtISO)).filter(Boolean)
    : [];
  const tokenUsage = normalizeCodexTokenUsage(body);
  if (!primaryLimit && !tokenUsage) {
    throw new Error("Codex usage v2 payload did not include rate limits or token usage.");
  }
  return {
    fetchedAtISO,
    source: "codex-usage-v2",
    planType: String(primaryLimit?.planType || body?.planType || body?.plan_type || "-"),
    allowed: !primaryLimit?.rateLimitReachedType,
    limitReached: Boolean(primaryLimit?.rateLimitReachedType),
    limitId: primaryLimit?.limitId || null,
    limitName: primaryLimit?.limitName || null,
    rateLimitReachedType: primaryLimit?.rateLimitReachedType || null,
    primaryWindow: primaryLimit?.primaryWindow || null,
    secondaryWindow: primaryLimit?.secondaryWindow || null,
    codeReviewWindow: additionalLimits.find((limit) => /review/i.test(String(limit.limitId || limit.limitName || "")))?.primaryWindow || null,
    credits: primaryLimit?.credits || normalizeCodexCredits({}),
    individualLimit: primaryLimit?.individualLimit || null,
    rateLimits: additionalLimits,
    tokenUsage
  };
}

function normalizeCodexUsageLegacyPayload(body, fetchedAtISO, sourceWarning = "") {
  return {
    fetchedAtISO,
    source: "wham-usage",
    sourceWarning,
    planType: String(body?.plan_type || "-"),
    allowed: Boolean(body?.rate_limit?.allowed),
    limitReached: Boolean(body?.rate_limit?.limit_reached),
    limitId: "codex",
    limitName: null,
    rateLimitReachedType: body?.rate_limit_reached_type || null,
    primaryWindow: mapRateLimitWindow(body?.rate_limit?.primary_window, fetchedAtISO),
    secondaryWindow: mapRateLimitWindow(body?.rate_limit?.secondary_window, fetchedAtISO),
    codeReviewWindow: mapRateLimitWindow(body?.code_review_rate_limit?.primary_window, fetchedAtISO),
    credits: normalizeCodexCredits(body?.credits || {}),
    individualLimit: body?.spend_control?.individual_limit || null,
    rateLimits: [],
    tokenUsage: null
  };
}

async function getCodexUsagePayload() {
  const token = getCodexAccessToken();
  const fetchedAtISO = new Date().toISOString();
  try {
    const body = await fetchCodexJson(CODEX_USAGE_V2_ENDPOINT, token);
    return normalizeCodexUsageV2Payload(body, fetchedAtISO);
  } catch (error) {
    const sourceWarning = `v2 unavailable: ${error.message || error}`;
    const body = await fetchCodexJson(CODEX_USAGE_LEGACY_ENDPOINT, token);
    return normalizeCodexUsageLegacyPayload(body, fetchedAtISO, sourceWarning);
  }
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

function normalizeString(raw, fieldName, options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  const value = String(raw || "").trim();
  if (!allowEmpty && !value) {
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
    .replace(/^[("'`[{<]+/, "")
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

function getOpenAIApiKey() {
  return String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "").trim();
}

function getGeminiApiKey() {
  return String(
    process.env.GEMINI_API_KEY
    || process.env.GOOGLE_AI_STUDIO_API_KEY
    || process.env.GOOGLE_API_KEY
    || ""
  ).trim();
}

function extractGeminiResponseText(payload) {
  if (!payload || typeof payload !== "object") return "";
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const first = candidates[0] || null;
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : [];
  const chunks = [];
  for (const part of parts) {
    const text = typeof part?.text === "string" ? part.text : "";
    if (text) chunks.push(text);
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
  const resetAtISO =
    UsageOverviewShared.getCodexWeeklyWindow(codexSummary)?.resetAtISO || "";
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

function buildCodexActivityContext(codexSummary) {
  const tokenUsage = codexSummary?.tokenUsage || null;
  const dailyRows = Array.isArray(tokenUsage?.dailyUsageBuckets)
    ? tokenUsage.dailyUsageBuckets
        .map((row) => ({
          date: String(row?.date || row?.startDate || "").slice(0, 10),
          tokens: Number(row?.tokens || 0)
        }))
        .filter((row) => row.date && Number.isFinite(row.tokens))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const sumTokens = (rows) => rows.reduce((sum, row) => sum + Number(row.tokens || 0), 0);
  const latest = dailyRows[dailyRows.length - 1] || null;
  const recent7dTokens = sumTokens(dailyRows.slice(-7));
  const recent14dTokens = sumTokens(dailyRows.slice(-14));
  const summary = tokenUsage?.summary || {};
  return {
    available: Boolean(tokenUsage),
    latestDate: latest?.date || null,
    latestDailyTokens: Number(latest?.tokens || 0),
    recent7dTokens,
    recent14dTokens,
    lifetimeTokens: Number(summary.lifetimeTokens || sumTokens(dailyRows) || 0),
    peakDailyTokens: Number(summary.peakDailyTokens || 0),
    currentStreakDays: Number(summary.currentStreakDays || 0),
    longestStreakDays: Number(summary.longestStreakDays || 0),
    longestRunningTurnSec: Number(summary.longestRunningTurnSec || 0)
  };
}

function buildUsageOverviewFallbackSummary({
  firestoreSummary,
  codexSummary,
  storageSummary,
  openaiSummary,
  roughCostSummary
}) {
  const fsToday = getFirestoreTodaySnapshotFromSummary(firestoreSummary);
  const codexSecondary = UsageOverviewShared.getCodexWeeklyWindow(codexSummary);
  const codexWeeklyTiming = buildCodexWeeklyTimingContext(codexSummary);
  const codexActivity = buildCodexActivityContext(codexSummary);
  const codexLimitPolicy = UsageOverviewShared.getCodexLimitPolicy();
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsedMonthRatio = dayOfMonth / Math.max(1, daysInMonth);
  const openaiTotalJpy = Number(roughCostSummary?.openaiJpy || 0);
  const openaiMonthEndJpy = openaiSummary?.available
    ? openaiTotalJpy / Math.max(0.001, elapsedMonthRatio)
    : 0;
  const storagePercent = storageSummary?.estimate?.percentOfNoCost || {};
  const storagePeak = Math.max(
    Number(storagePercent.storage || 0),
    Number(storagePercent.download || 0),
    Number(storagePercent.classA || 0),
    Number(storagePercent.classB || 0)
  );
  const firestorePeak = Math.max(
    Number(fsToday?.ratePercent?.read || 0),
    Number(fsToday?.ratePercent?.write || 0),
    Number(fsToday?.ratePercent?.delete || 0)
  );

  return [
    `total: ¥${Math.round(Number(roughCostSummary?.totalJpy || 0))} / redline ¥3000 に対して ${Number(roughCostSummary?.totalJpy || 0) < 3000 ? "余裕あり" : "注意"}`,
    `codex: ${codexLimitPolicy.fiveHourLimitStatus === "temporarily_lifted" ? "5h limit一時解除中（GPT-5.6開始措置）、" : ""}1w used ${Math.round(Number(codexSecondary?.usedPercent || 0))}%、resetまで約${Math.max(0, Number(codexWeeklyTiming?.hoursUntilWeeklyReset || 0))}h${codexActivity.available ? `、7d ${Math.round(codexActivity.recent7dTokens)} tokens / lifetime ${Math.round(codexActivity.lifetimeTokens)} tokens` : ""}`,
    openaiSummary?.available
      ? `openai: 月末見込み ¥${Math.round(openaiMonthEndJpy)}、現時点 ¥${Math.round(openaiTotalJpy)} (${dayOfMonth}/${daysInMonth})`
      : "openai: 利用額未取得",
    `storage: 無料枠ペース最大 ${storagePeak.toFixed(1)}% で ${storagePeak < 100 ? "枠内ペース" : "超過注意"}`,
    `firestore: 無料枠ペース最大 ${firestorePeak.toFixed(1)}% で ${firestorePeak < 100 ? "枠内ペース" : "超過注意"}`
  ].join("\n");
}

// ★ 変更1: 空文字・超短文のみチェック、5行縛り廃止
function normalizeUsageOverviewSummary(summary, fallbackSummary) {
  const raw = String(summary || "").trim();
  if (!raw || raw.length < 20) return fallbackSummary;
  return raw;
}

function shouldUseAiUsageOverviewSummary() {
  return String(process.env.USAGE_OVERVIEW_SUMMARY_MODE || "").trim().toLowerCase() === "ai";
}

function getUsageOverviewSummaryMode() {
  const value = String(process.env.USAGE_OVERVIEW_SUMMARY_MODE || "").trim().toLowerCase();
  return value || "local";
}

function getUsageOverviewSummaryProvider() {
  return normalizeUsageOverviewSummaryProvider(process.env.USAGE_OVERVIEW_SUMMARY_PROVIDER);
}

function getUsageOverviewSummaryModel() {
  const value = String(process.env.USAGE_OVERVIEW_SUMMARY_MODEL || "").trim();
  return value || "gpt-4o-mini";
}

function parseModelList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUsageOverviewSummaryProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return provider === "gemini" ? "gemini" : "openai";
}

function inferUsageOverviewSummaryProvider(model, fallbackProvider = getUsageOverviewSummaryProvider()) {
  const raw = String(model || "").trim().toLowerCase();
  if (/^(models\/)?gemini[-.]/.test(raw)) return "gemini";
  if (/^(gpt-|o\d|chatgpt-|chat-latest)/.test(raw)) return "openai";
  return normalizeUsageOverviewSummaryProvider(fallbackProvider);
}

function parseUsageOverviewSummaryModelSpec(value, fallbackProvider = getUsageOverviewSummaryProvider()) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(openai|gemini)[:/](.+)$/i);
  if (match) {
    return {
      provider: normalizeUsageOverviewSummaryProvider(match[1]),
      model: match[2].trim()
    };
  }
  return {
    provider: inferUsageOverviewSummaryProvider(raw, fallbackProvider),
    model: raw
  };
}

function formatUsageOverviewSummaryModelSpec(spec) {
  const provider = normalizeUsageOverviewSummaryProvider(spec?.provider);
  const model = String(spec?.model || "").trim();
  return model ? `${provider}:${model}` : provider;
}

function getUsageOverviewSummaryModelSpecs() {
  const fallbackProvider = getUsageOverviewSummaryProvider();
  const rawModels = parseModelList(process.env.USAGE_OVERVIEW_SUMMARY_MODELS);
  const specs = (rawModels.length ? rawModels : [getUsageOverviewSummaryModel()])
    .map((model) => parseUsageOverviewSummaryModelSpec(model, fallbackProvider))
    .filter((spec) => spec.model);
  const seen = new Set();
  return specs.filter((spec) => {
    const key = formatUsageOverviewSummaryModelSpec(spec);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getUsageOverviewSummaryModels() {
  return getUsageOverviewSummaryModelSpecs().map(formatUsageOverviewSummaryModelSpec);
}

function getUsageOverviewSummaryModelChainLabel() {
  return getUsageOverviewSummaryModels().join(" -> ");
}

function getUsageOverviewSummaryModelsForProvider(provider) {
  const normalized = normalizeUsageOverviewSummaryProvider(provider);
  return getUsageOverviewSummaryModelSpecs()
    .filter((spec) => spec.provider === normalized)
    .map((spec) => spec.model);
}

function buildUsageOverviewAiErrorModelLabel(models) {
  const attempted = Array.isArray(models) ? models.filter(Boolean) : [];
  if (!attempted.length) return "local-template(ai-error)";
  return `local-template(ai-error after ${attempted.join(" -> ")})`;
}

function getMemoSummaryProvider() {
  const value = String(process.env.MEMO_SUMMARY_PROVIDER || "").trim().toLowerCase();
  return value || "openai";
}

function getMemoSummaryModel() {
  const value = String(process.env.MEMO_SUMMARY_MODEL || "").trim();
  return value || "gpt-4.1-nano";
}

// ★ 変更2: system prompt・user JSON・max_output_tokens を最適化
async function summarizeUsageOverviewWithOpenAI({
  firestoreSummary,
  codexSummary,
  storageSummary,
  openaiSummary,
  roughCostSummary
}, options = {}) {
  if (!firestoreSummary || !codexSummary) throw new Error("firestoreSummary and codexSummary are required.");

  const fsToday = getFirestoreTodaySnapshotFromSummary(firestoreSummary);
  const fsTrend = computeFirestore14dTrendFromSummary(firestoreSummary);
  const codexSecondary = UsageOverviewShared.getCodexWeeklyWindow(codexSummary);
  const codexWeeklyTiming = buildCodexWeeklyTimingContext(codexSummary);
  const codexActivity = buildCodexActivityContext(codexSummary);
  const codexLimitPolicy = UsageOverviewShared.getCodexLimitPolicy();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const elapsedMonthRatio = dayOfMonth / Math.max(1, daysInMonth);
  const openaiTotalUsd30d = Number(openaiSummary?.available ? openaiSummary?.totalUsd30d || 0 : 0);
  const roughTotalJpy = Number(roughCostSummary?.totalJpy || 0);
  const storagePercent = storageSummary?.estimate?.percentOfNoCost || {};
  const limits = firestoreSummary?.limitsDaily || {};
  const fallbackSummary = buildUsageOverviewFallbackSummary({
    firestoreSummary,
    codexSummary,
    storageSummary,
    openaiSummary,
    roughCostSummary
  });
  const models = Array.isArray(options.models)
    ? options.models.filter(Boolean)
    : getUsageOverviewSummaryModelsForProvider("openai");
  const fallbackOnError = options.fallbackOnError !== false;

  if (!shouldUseAiUsageOverviewSummary()) {
    return { summary: fallbackSummary, model: "local-template(mode!=ai)" };
  }

  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    if (!fallbackOnError) throw new Error("OPENAI_API_KEY or OPENAI_KEY is not set.");
    return { summary: fallbackSummary, model: "local-template(no-openai-key)" };
  }

  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: `You are a cloud service usage analyst. Analyze the usage data and output a concise Japanese paragraph (300–400 chars). Cover key metrics, cost anomalies, and optimization actions. No bullet points, no intro, no conclusion. ${codexLimitPolicy.summaryInstruction} Openaiのusageは再重要事項。課金発生要因について必ず言及すること。Example — INPUT:「月額合計¥94（OpenAI ¥94 / Storage ¥0）上限¥3000。Firestore読み取り今月6.2%使用、2/28は3077件と急増。Codex週次残85%。」OUTPUT:「月額コストは¥94と上限¥3000に対して余裕があり、現ペースなら月末も同水準の見込み。ただし2/28のFirestoreリードが3077件と前日比約20倍に急増しており原因の特定が急務。無料枠・Codex枠ともに残量は十分だが、読み取り急増が継続すると無料枠の圧迫リスクがある。」`
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            totalCost: {
              roughTotalJpy: Number(roughTotalJpy.toFixed(0)),
              storageJpy: Number(Number(roughCostSummary?.storageJpy || 0).toFixed(0)),
              openaiJpy: Number(Number(roughCostSummary?.openaiJpy || 0).toFixed(0)),
              redlineJpy: 3000
            },
            codex: {
              planType: codexSummary?.planType || null,
              limitPolicy: {
                fiveHourLimitStatus: codexLimitPolicy.fiveHourLimitStatus,
                activeLimitWindow: codexLimitPolicy.activeLimitWindow,
                reason: codexLimitPolicy.reason
              },
              usedPercent: Number(codexSecondary?.usedPercent ?? 0),
              remainingPercent: Number(codexSecondary?.remainingPercent ?? 0),
              hoursUntilReset: codexWeeklyTiming?.hoursUntilWeeklyReset ?? null,
              resetAtISO: codexSecondary?.resetAtISO || null,
              activity: {
                available: codexActivity.available,
                latestDate: codexActivity.latestDate,
                latestDailyTokens: codexActivity.latestDailyTokens,
                recent7dTokens: codexActivity.recent7dTokens,
                lifetimeTokens: codexActivity.lifetimeTokens,
                peakDailyTokens: codexActivity.peakDailyTokens,
                currentStreakDays: codexActivity.currentStreakDays,
                longestStreakDays: codexActivity.longestStreakDays
              }
            },
            openai: {
              available: Boolean(openaiSummary?.available),
              dayOfMonth,
              daysInMonth,
              monthToDateJpy: Number(Number(roughCostSummary?.openaiJpy || 0).toFixed(0)),
              last14dUsd: Number(Number(openaiSummary?.totalUsd14d || 0).toFixed(3)),
              billedLineItems14d: Array.isArray(openaiSummary?.lineItems14d)
                ? openaiSummary.lineItems14d.map((item) => ({
                  name: item.name,
                  amountUsd: Number(Number(item.amountUsd || 0).toFixed(3))
                }))
                : [],
              projectedMonthEndJpy: openaiSummary?.available
                ? Number((openaiTotalUsd30d / Math.max(0.001, elapsedMonthRatio)).toFixed(0))
                : null
            },
            storage: {
              peakNoCostPercent: Math.max(
                Number(storagePercent.storage || 0),
                Number(storagePercent.download || 0),
                Number(storagePercent.classA || 0),
                Number(storagePercent.classB || 0)
              ),
              roughMonthlyOverageUsd: Number(storageSummary?.estimate?.estimatedMonthlyUsd || 0)
            },
            firestore: {
              limitsDaily: {
                read: Number(limits.read || 0),
                write: Number(limits.write || 0),
                delete: Number(limits.delete || 0)
              },
              todayRatePercent: fsToday.ratePercent,
              trend7d: {
                read: Number(fsTrend.trend.read.avgRateLast7.toFixed(2)),
                write: Number(fsTrend.trend.write.avgRateLast7.toFixed(2)),
                delete: Number(fsTrend.trend.delete.avgRateLast7.toFixed(2))
              },
              max14d: {
                read: Number(fsTrend.trend.read.maxRate14d.toFixed(2)),
                write: Number(fsTrend.trend.write.maxRate14d.toFixed(2)),
                delete: Number(fsTrend.trend.delete.maxRate14d.toFixed(2))
              }
            }
          }, null, 0)
        }
      ]
    }
  ];

  const errors = [];
  for (const model of models) {
    try {
      const res = await fetch(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input,
          max_output_tokens: 840  // 文章形式なので220→400に拡張
        })
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = payload?.error?.message || `OpenAI API error (${res.status})`;
        throw new Error(message);
      }
      const summary = extractOpenAIResponseText(payload);
      if (!String(summary || "").trim()) {
        throw new Error("OpenAI response did not contain summary text.");
      }
      return {
        summary: normalizeUsageOverviewSummary(summary, fallbackSummary),
        model
      };
    } catch (error) {
      errors.push(`${model}: ${error?.message || String(error)}`);
    }
  }
  if (errors.length) {
    console.warn(`[usage-summary] OpenAI summarize fallback: ${errors.join(" | ")}`);
  }
  if (!fallbackOnError) {
    throw new Error(errors.join(" | ") || "No OpenAI usage overview summary models configured.");
  }
  return {
    summary: fallbackSummary,
    model: buildUsageOverviewAiErrorModelLabel(models.map((model) => `openai:${model}`))
  };
}

async function summarizeUsageOverviewWithGemini({
  firestoreSummary,
  codexSummary,
  storageSummary,
  openaiSummary,
  roughCostSummary
}, options = {}) {
  if (!firestoreSummary || !codexSummary) throw new Error("firestoreSummary and codexSummary are required.");

  const fsToday = getFirestoreTodaySnapshotFromSummary(firestoreSummary);
  const fsTrend = computeFirestore14dTrendFromSummary(firestoreSummary);
  const codexSecondary = UsageOverviewShared.getCodexWeeklyWindow(codexSummary);
  const codexWeeklyTiming = buildCodexWeeklyTimingContext(codexSummary);
  const codexActivity = buildCodexActivityContext(codexSummary);
  const codexLimitPolicy = UsageOverviewShared.getCodexLimitPolicy();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const elapsedMonthRatio = dayOfMonth / Math.max(1, daysInMonth);
  const openaiTotalUsd30d = Number(openaiSummary?.available ? openaiSummary?.totalUsd30d || 0 : 0);
  const roughTotalJpy = Number(roughCostSummary?.totalJpy || 0);
  const storagePercent = storageSummary?.estimate?.percentOfNoCost || {};
  const limits = firestoreSummary?.limitsDaily || {};
  const fallbackSummary = buildUsageOverviewFallbackSummary({
    firestoreSummary,
    codexSummary,
    storageSummary,
    openaiSummary,
    roughCostSummary
  });
  const models = Array.isArray(options.models)
    ? options.models.filter(Boolean)
    : getUsageOverviewSummaryModelsForProvider("gemini");
  const fallbackOnError = options.fallbackOnError !== false;

  if (!shouldUseAiUsageOverviewSummary()) {
    return { summary: fallbackSummary, model: "local-template(mode!=ai)" };
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    if (!fallbackOnError) throw new Error("GEMINI_API_KEY is not set.");
    return { summary: fallbackSummary, model: "local-template(no-gemini-key)" };
  }

  const payloadInput = {
    totalCost: {
      roughTotalJpy: Number(roughTotalJpy.toFixed(0)),
      storageJpy: Number(Number(roughCostSummary?.storageJpy || 0).toFixed(0)),
      openaiJpy: Number(Number(roughCostSummary?.openaiJpy || 0).toFixed(0)),
      redlineJpy: DEFAULT_BUDGET_JPY
    },
    codex: {
      planType: codexSummary?.planType || null,
      limitPolicy: {
        fiveHourLimitStatus: codexLimitPolicy.fiveHourLimitStatus,
        activeLimitWindow: codexLimitPolicy.activeLimitWindow,
        reason: codexLimitPolicy.reason
      },
      usedPercent: Number(codexSecondary?.usedPercent ?? 0),
      remainingPercent: Number(codexSecondary?.remainingPercent ?? 0),
      hoursUntilReset: codexWeeklyTiming?.hoursUntilWeeklyReset ?? null,
      resetAtISO: codexSecondary?.resetAtISO || null,
      activity: {
        available: codexActivity.available,
        latestDate: codexActivity.latestDate,
        latestDailyTokens: codexActivity.latestDailyTokens,
        recent7dTokens: codexActivity.recent7dTokens,
        lifetimeTokens: codexActivity.lifetimeTokens,
        peakDailyTokens: codexActivity.peakDailyTokens,
        currentStreakDays: codexActivity.currentStreakDays,
        longestStreakDays: codexActivity.longestStreakDays
      }
    },
    firestore: {
      today: {
        read: Number(fsTrend?.latest?.read || 0),
        write: Number(fsTrend?.latest?.write || 0),
        delete: Number(fsTrend?.latest?.delete || 0),
        ratePercent: fsToday?.ratePercent || {}
      },
      limitsDaily: limits,
      trend14d: fsTrend?.trend || {}
    },
    storage: {
      estimatePercentOfNoCost: storagePercent || {}
    },
    openai: {
      available: Boolean(openaiSummary?.available),
      totalUsd30d: Number(openaiTotalUsd30d.toFixed(3)),
      totalUsd14d: Number(Number(openaiSummary?.totalUsd14d || 0).toFixed(3))
    },
    month: {
      dayOfMonth,
      daysInMonth,
      elapsedRatio: Number(elapsedMonthRatio.toFixed(4))
    }
  };

  const prompt = [
    "あなたはクラウドサービス利用状況のアナリストです。",
    "入力のJSONを分析し、日本語の1段落（300〜400文字）で要約してください。",
    "必ず含める: 主要メトリクス / コスト異常の兆候 / 最優先の最適化アクション。",
    "禁止: 箇条書き、前置き、結論っぽい締め。",
    codexLimitPolicy.summaryInstruction,
    "重要: OpenAIのusageが取得できている場合は課金発生要因にも触れる。",
    "",
    "INPUT(JSON):",
    JSON.stringify(payloadInput)
  ].join("\n");

  const errors = [];
  for (const model of models) {
    try {
      const res = await fetch(`${GEMINI_GENERATE_CONTENT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = payload?.error?.message || `Gemini API error (${res.status})`;
        throw new Error(message);
      }

      const summary = extractGeminiResponseText(payload);
      if (!String(summary || "").trim()) {
        throw new Error("Gemini response did not contain summary text.");
      }
      return {
        summary: normalizeUsageOverviewSummary(summary, fallbackSummary),
        model
      };
    } catch (error) {
      errors.push(`${model}: ${error?.message || String(error)}`);
    }
  }
  if (errors.length) {
    console.warn(`[usage-summary] Gemini summarize fallback: ${errors.join(" | ")}`);
  }
  if (!fallbackOnError) {
    throw new Error(errors.join(" | ") || "No Gemini usage overview summary models configured.");
  }
  return {
    summary: fallbackSummary,
    model: buildUsageOverviewAiErrorModelLabel(models.map((model) => `gemini:${model}`))
  };
}

async function summarizeUsageOverview({
  firestoreSummary,
  codexSummary,
  storageSummary,
  openaiSummary,
  roughCostSummary
}) {
  const fallbackSummary = buildUsageOverviewFallbackSummary({
    firestoreSummary,
    codexSummary,
    storageSummary,
    openaiSummary,
    roughCostSummary
  });
  if (!shouldUseAiUsageOverviewSummary()) {
    return { summary: fallbackSummary, model: "local-template(mode!=ai)" };
  }

  const specs = getUsageOverviewSummaryModelSpecs();
  const errors = [];
  for (const spec of specs) {
    try {
      const args = {
        firestoreSummary,
        codexSummary,
        storageSummary,
        openaiSummary,
        roughCostSummary
      };
      if (spec.provider === "gemini") {
        return await summarizeUsageOverviewWithGemini(args, {
          models: [spec.model],
          fallbackOnError: false
        });
      }
      return await summarizeUsageOverviewWithOpenAI(args, {
        models: [spec.model],
        fallbackOnError: false
      });
    } catch (error) {
      errors.push(`${formatUsageOverviewSummaryModelSpec(spec)}: ${error?.message || String(error)}`);
    }
  }
  if (errors.length) {
    console.warn(`[usage-summary] usage overview summarize fallback: ${errors.join(" | ")}`);
  }
  return {
    summary: fallbackSummary,
    model: buildUsageOverviewAiErrorModelLabel(specs.map(formatUsageOverviewSummaryModelSpec))
  };
}

async function summarizeMemoWithOpenAI({ threadTitle, memoBody }) {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY or OPENAI_KEY is not set.");
  }
  const title = String(threadTitle || "").trim();
  const body = String(memoBody || "").trim();
  if (!body) throw new Error("memoBody is required.");
  const clipped = body.slice(0, 20000);
  const model = getMemoSummaryModel();

  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: "You summarize memo text in Japanese. Summarize the following Japanese memo into 3–6 lines of flowing Japanese prose. Be concise, preserve key facts and action items, skip preamble. Example — Input:  Cloud Run vs Cloud Functions\n## Cloud Run\n- コンテナベース、HTTP向け、タイムアウト最長60分\n## Cloud Functions\n- イベント駆動、軽量処理向き、デプロイ簡単\n## 活用案\n- Cloud Run: API化、Cloud Functions: Firestoreトリガー  Output: Cloud RunはDockerコンテナで動くHTTP向けサービスで、長時間処理や複雑なロジックに強い。Cloud FunctionsはFirestoreやStorageなどのイベント駆動に特化した軽量関数実行環境。両者とも月200万回の無料枠があり、組み合わせて使うのが最適。hush-pointerにはCloud RunでAPI化、Cloud FunctionsでFirestoreトリガー処理が推奨構成。"
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
      model,
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
  return { summary, model };
}

async function summarizeMemoWithGemini({ threadTitle, memoBody }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set.");
  }
  const title = String(threadTitle || "").trim();
  const body = String(memoBody || "").trim();
  if (!body) throw new Error("memoBody is required.");
  const clipped = body.slice(0, 20000);
  const model = getMemoSummaryModel();

  const prompt = [
    "次の日本語メモを、3〜6行の流れる日本語（箇条書き禁止）で短く要約して。",
    "事実と次アクションは落とさない。前置き・結論は不要。",
    title ? `Thread: ${title}` : "",
    "",
    "Memo body:",
    clipped
  ].filter(Boolean).join("\n");

  const res = await fetch(`${GEMINI_GENERATE_CONTENT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 }
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error?.message || `Gemini API error (${res.status})`;
    throw new Error(message);
  }
  const summary = extractGeminiResponseText(payload);
  if (!summary) {
    throw new Error("Gemini response did not contain summary text.");
  }
  return { summary, model };
}

async function summarizeMemo({ threadTitle, memoBody }) {
  const provider = getMemoSummaryProvider();
  if (provider === "gemini") {
    return summarizeMemoWithGemini({ threadTitle, memoBody });
  }
  return summarizeMemoWithOpenAI({ threadTitle, memoBody });
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
      adapterDetails: getAdapterRuntimeDetails(adapterRegistry),
      usdToJpy: Number(process.env.USD_TO_JPY || 150),
      usageOverviewSummaryMode: getUsageOverviewSummaryMode(),
      memoSummaryProvider: getMemoSummaryProvider(),
      memoSummaryModel: getMemoSummaryModel(),
      usageOverviewSummaryProvider: getUsageOverviewSummaryProvider(),
      usageOverviewSummaryModel: getUsageOverviewSummaryModelChainLabel(),
      usageOverviewSummaryModelChain: getUsageOverviewSummaryModels(),
      hasOpenAiSummaryKey: Boolean(getOpenAIApiKey()),
      hasGeminiSummaryKey: Boolean(getGeminiApiKey()),
      memoCachePolicy: {
        listTtlMs: MEMO_LIST_CACHE_TTL_MS,
        detailTtlMs: MEMO_DETAIL_CACHE_TTL_MS,
        countTtlMs: MEMO_COUNT_CACHE_TTL_MS,
        attachmentTtlMs: MEMO_ATTACHMENT_CACHE_TTL_MS
      }
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
      const cacheKey = `list-source:${JSON.stringify({ limit, allowedAdapters: runtimeConfig.allowedAdapters })}`;
      const loaded = await loadThroughMemoResponseCache({
        cache: cacheStore,
        key: cacheKey,
        ttlMs: MEMO_LIST_CACHE_TTL_MS,
        forceReload: noCache,
        loader: () => memoService.listMemos(limit)
      });
      const sourceMemos = loaded.value;
      let memos = [...sourceMemos];

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
      for (const item of sourceMemos) {
        setCache(`detail:${item.id}`, { item }, MEMO_DETAIL_CACHE_TTL_MS);
      }
      res.setHeader("X-Cache", loaded.cacheHit ? "HIT" : "MISS");
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to fetch memos." });
    }
  });

  app.get("/api/memo-counts", async (req, res) => {
    try {
      const noCache = String(req.query.nocache || "").trim() === "1";
      const cacheKey = "memo-counts";
      const loaded = await loadThroughMemoResponseCache({
        cache: cacheStore,
        key: cacheKey,
        ttlMs: MEMO_COUNT_CACHE_TTL_MS,
        forceReload: noCache,
        loader: async () => ({ counts: await memoService.countMemosByStorageKind() })
      });
      res.setHeader("X-Cache", loaded.cacheHit ? "HIT" : "MISS");
      res.json(loaded.value);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to count memos." });
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

  app.get("/api/usage/storage", async (req, res) => {
    try {
      const noCache = String(req.query.nocache || "").trim() === "1";
      const cacheKey = "usage:storage";
      if (!noCache) {
        const cached = getCache(cacheKey);
        if (cached) {
          res.setHeader("X-Cache", "HIT");
          res.json(cached);
          return;
        }
      }

      const payload = await getStorageUsagePayload();
      if (!noCache) {
        setCache(cacheKey, payload, STORAGE_USAGE_CACHE_TTL_MS);
      }
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to fetch Storage usage." });
    }
  });

  app.get("/api/usage/openai-costs", async (req, res) => {
    try {
      const noCache = String(req.query.nocache || "").trim() === "1";
      const cacheKey = "usage:openai-costs";
      if (!noCache) {
        const cached = getCache(cacheKey);
        if (cached) {
          res.setHeader("X-Cache", "HIT");
          res.json(cached);
          return;
        }
      }

      const payload = await getOpenAICostsPayload();
      if (!noCache) {
        setCache(cacheKey, payload, OPENAI_COSTS_CACHE_TTL_MS);
      }
      res.setHeader("X-Cache", "MISS");
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to fetch OpenAI costs." });
    }
  });

  app.get("/api/memos/:id", async (req, res) => {
    try {
      const cacheKey = `detail:${req.params.id}`;
      const noCache = String(req.query.nocache || "").trim() === "1";
      const loaded = await loadThroughMemoResponseCache({
        cache: cacheStore,
        key: cacheKey,
        ttlMs: MEMO_DETAIL_CACHE_TTL_MS,
        forceReload: noCache,
        loader: async () => ({ item: await memoService.getMemo(req.params.id) })
      });
      const item = loaded.value.item;
      if (!item) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }
      res.setHeader("X-Cache", loaded.cacheHit ? "HIT" : "MISS");
      res.json(loaded.value);
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to fetch memo." });
    }
  });

  app.post("/api/memos", async (req, res) => {
    try {
      const payload = {
        projectName: normalizeString(req.body.projectName, "projectName"),
        memoType: normalizeMemoType(req.body.memoType),
        memoBody: normalizeString(req.body.memoBody, "memoBody", { allowEmpty: true }),
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
      const createIfMissing = normalizeBool(req.body.createIfMissing, false);

      const patch = {
        projectName: normalizeString(req.body.projectName, "projectName"),
        memoType: normalizeMemoType(req.body.memoType),
        memoBody: normalizeString(req.body.memoBody, "memoBody", { allowEmpty: true }),
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

      if (!exists.exists) {
        if (!createIfMissing) {
          res.status(404).json({ error: "Memo not found." });
          return;
        }
        assertExclusiveFlags(Boolean(patch.pinned), Boolean(patch.deletable));
        const created = await memoService.createMemo({
          ...patch,
          id: req.params.id,
          createdBy: req.body.createdBy || "codex-memo-web",
          sourceThread: req.body.sourceThread || process.cwd()
        });
        clearCache();
        res.status(201).json({ item: created });
        return;
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
      const memoPayload = await loadThroughMemoResponseCache({
        cache: cacheStore,
        key: `detail:${req.params.id}`,
        ttlMs: MEMO_DETAIL_CACHE_TTL_MS,
        loader: async () => ({ item: await memoService.getMemo(req.params.id) })
      });
      const memo = memoPayload.value.item;
      if (!memo) {
        res.status(404).json({ error: "Memo not found." });
        return;
      }
      const attachment = (memo.attachments || []).find((item) => item.id === req.params.attachmentId);
      if (!attachment) {
        res.status(404).json({ error: "Attachment not found." });
        return;
      }

      const resolvedPayload = await loadThroughMemoResponseCache({
        cache: cacheStore,
        key: `attachment:${memo.id}:${attachment.id}`,
        ttlMs: MEMO_ATTACHMENT_CACHE_TTL_MS,
        loader: () => adapterRegistry.getAdapter(memo.storageKind).resolveAttachmentUrl({
          memoId: memo.id,
          attachmentId: attachment.id,
          attachment
        })
      });
      const resolved = resolvedPayload.value;
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
        deletable
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

      const memoPayload = await loadThroughMemoResponseCache({
        cache: cacheStore,
        key: `detail:${req.params.id}`,
        ttlMs: MEMO_DETAIL_CACHE_TTL_MS,
        loader: async () => ({ item: await memoService.getMemo(req.params.id) })
      });
      const memo = memoPayload.value.item;
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
      const result = await summarizeMemo({ threadTitle, memoBody });
      res.json(result);
    } catch (error) {
      const message = error.message || "Failed to summarize memo.";
      const code = /OPENAI_API_KEY|OPENAI_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_AI_STUDIO_API_KEY/.test(String(message))
        ? 503
        : 500;
      res.status(code).json({ error: message });
    }
  });

  app.post("/api/usage/overview-summary", async (req, res) => {
    try {
      const firestoreSummary = req.body?.firestoreSummary || null;
      const codexSummary = req.body?.codexSummary || null;
      const storageSummary = req.body?.storageSummary || null;
      const openaiSummary = req.body?.openaiSummary || null;
      const roughCostSummary = req.body?.roughCostSummary || null;
      if (!firestoreSummary || !codexSummary) {
        res.status(400).json({ error: "firestoreSummary and codexSummary are required." });
        return;
      }
      const result = await summarizeUsageOverview({
        firestoreSummary,
        codexSummary,
        storageSummary,
        openaiSummary,
        roughCostSummary
      });
      res.json(result);
    } catch (error) {
      const message = error.message || "Failed to summarize usage overview.";
      const code = /OPENAI_API_KEY|OPENAI_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_AI_STUDIO_API_KEY/.test(String(message))
        ? 503
        : 500;
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

module.exports = {
  buildUsageOverviewAiErrorModelLabel,
  formatUsageOverviewSummaryModelSpec,
  getUsageOverviewSummaryModelChainLabel,
  getUsageOverviewSummaryModelSpecs,
  getUsageOverviewSummaryModels,
  inferUsageOverviewSummaryProvider,
  parseUsageOverviewSummaryModelSpec
};

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to start codex-memo web app:", error.message);
    process.exit(1);
  });
}
