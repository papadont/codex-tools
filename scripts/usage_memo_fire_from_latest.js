#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { saveMemoRecord } = require("./codex_memo_core");
const { loadEnvFromCandidates } = require("./load_env");
const UsageOverviewShared = require("../codex-memo-web/public/usage_overview_shared");

const LATEST_PATH = path.join(
  process.cwd(),
  "dist",
  "usage-reports",
  "weekly",
  "latest.json",
);
const STATE_PATH = path.join(
  process.cwd(),
  "dist",
  "usage-reports",
  "weekly",
  ".memo-trigger-state.json",
);
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const GEMINI_GENERATE_CONTENT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

loadEnvFromCandidates();

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad2 = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

function formatTitleDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad2 = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return `${yyyy}/${mm}/${dd}`;
}

function formatPercent(value, digits = 3) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "-";
}

function boldPercent(value, digits = 1) {
  return `**${formatPercent(value, digits)}**`;
}

function formatNumber(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "0";
}

function loadLatest() {
  const raw = fs.readFileSync(LATEST_PATH, "utf8");
  return JSON.parse(raw);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function formatUsd(value, digits = 2) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? `$${n.toFixed(digits)}` : "-";
}

function formatJpy(value, digits = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  return `¥${n.toFixed(digits)}`;
}

function formatNumberCompact(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let current = n / 1024;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  const digits = current >= 100 ? 0 : current >= 10 ? 1 : 2;
  return `${current.toFixed(digits)} ${units[index]}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatPeakPaceMetric(label, value) {
  return `${label} ${boldPercent(value, 0)}`;
}

function getFirestoreTodaySnapshot(firestoreSummary) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const perDay = Array.isArray(firestoreSummary?.perDay)
    ? firestoreSummary.perDay
    : [];
  const today = perDay.find((d) => d.date === todayKey) ||
    perDay[perDay.length - 1] || {
      read: 0,
      write: 0,
      delete: 0,
      date: todayKey,
    };
  const recent = perDay.slice(-14);
  const recentExcludingToday = recent.filter(
    (d) => String(d?.date || "") !== String(today?.date || ""),
  );
  const limits = firestoreSummary?.limitsDaily || {
    read: 50000,
    write: 20000,
    delete: 20000,
  };
  const ratePercent = {
    read: Number(
      today?.ratePercent?.read ??
        (Number(today.read || 0) / Math.max(1, Number(limits.read || 1))) * 100,
    ),
    write: Number(
      today?.ratePercent?.write ??
        (Number(today.write || 0) / Math.max(1, Number(limits.write || 1))) *
          100,
    ),
    delete: Number(
      today?.ratePercent?.delete ??
        (Number(today.delete || 0) / Math.max(1, Number(limits.delete || 1))) *
          100,
    ),
  };
  const maxInRecent = {
    read: Math.max(1, ...recentExcludingToday.map((d) => Number(d.read || 0))),
    write: Math.max(
      1,
      ...recentExcludingToday.map((d) => Number(d.write || 0)),
    ),
    delete: Math.max(
      1,
      ...recentExcludingToday.map((d) => Number(d.delete || 0)),
    ),
  };
  const relativePercent = {
    read:
      (Number(today.read || 0) / Math.max(1, Number(maxInRecent.read || 1))) *
      100,
    write:
      (Number(today.write || 0) / Math.max(1, Number(maxInRecent.write || 1))) *
      100,
    delete:
      (Number(today.delete || 0) /
        Math.max(1, Number(maxInRecent.delete || 1))) *
      100,
  };
  return { today, ratePercent, relativePercent };
}

function getFirestoreActivitySnapshot(firestoreSummary) {
  const rows = Array.isArray(firestoreSummary?.perDay)
    ? firestoreSummary.perDay.slice(-14)
    : [];
  const totalFor = (key) =>
    rows.reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
  const peakFor = (key) =>
    rows.reduce(
      (peak, row) =>
        Number(row?.[key] || 0) > Number(peak?.value || 0)
          ? { date: row?.date || "-", value: Number(row?.[key] || 0) }
          : peak,
      { date: "-", value: 0 },
    );
  const days = Math.max(1, rows.length);
  return {
    days: rows.length,
    read: {
      total: totalFor("read"),
      avg: totalFor("read") / days,
      peak: peakFor("read"),
    },
    write: {
      total: totalFor("write"),
      avg: totalFor("write") / days,
      peak: peakFor("write"),
    },
    delete: {
      total: totalFor("delete"),
      avg: totalFor("delete") / days,
      peak: peakFor("delete"),
    },
  };
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
  return String(
    process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "",
  ).trim();
}

function getGeminiApiKey() {
  return String(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_AI_STUDIO_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      "",
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

function computeFirestore14dTrend(firestoreSummary) {
  const perDay = Array.isArray(firestoreSummary?.perDay)
    ? firestoreSummary.perDay
    : [];
  const last14 = perDay.slice(-14);
  const first7 = last14.slice(0, 7);
  const last7 = last14.slice(-7);
  const sum = (rows, key) =>
    rows.reduce((acc, row) => acc + Number(row?.[key] || 0), 0);
  const avg = (rows, key) => (rows.length ? sum(rows, key) / rows.length : 0);
  const latest = last14[last14.length - 1] || null;
  const prev = last14[last14.length - 2] || null;

  const avgRate = (rows, key) => {
    if (!rows.length) return 0;
    return (
      rows.reduce((acc, row) => acc + Number(row?.ratePercent?.[key] || 0), 0) /
      rows.length
    );
  };
  const maxRate = (rows, key) =>
    rows.reduce(
      (m, row) => Math.max(m, Number(row?.ratePercent?.[key] || 0)),
      0,
    );
  const trend = {};
  for (const key of ["read", "write", "delete"]) {
    const avgFirst7 = avg(first7, key);
    const avgLast7 = avg(last7, key);
    trend[key] = {
      avgFirst7,
      avgLast7,
      deltaAvg: avgLast7 - avgFirst7,
      latest: Number(latest?.[key] || 0),
      prev: Number(prev?.[key] || 0),
      deltaDay: Number(latest?.[key] || 0) - Number(prev?.[key] || 0),
      latestRate: Number(latest?.ratePercent?.[key] || 0),
      prevRate: Number(prev?.ratePercent?.[key] || 0),
      deltaRateDay:
        Number(latest?.ratePercent?.[key] || 0) -
        Number(prev?.ratePercent?.[key] || 0),
      avgRateFirst7: avgRate(first7, key),
      avgRateLast7: avgRate(last7, key),
      deltaAvgRate: avgRate(last7, key) - avgRate(first7, key),
      maxRate14d: maxRate(last14, key),
    };
  }
  return { last14, latest, prev, trend };
}

function getStorageSnapshot(storageSummary) {
  const summary = storageSummary || null;
  const estimate = summary?.estimate || {};
  const percent = estimate.percentOfNoCost || {};
  const noCost = summary?.noCost || {};
  return {
    peakPercent: Math.max(
      Number(percent.storage || 0),
      Number(percent.download || 0),
      Number(percent.classA || 0),
      Number(percent.classB || 0),
    ),
    bytes: Number(summary?.current?.totalBytes || 0),
    objects: Number(summary?.current?.totalObjects || 0),
    egressBytes30d: Number(summary?.last30d?.egressBytes || 0),
    storageLimitGb: Number(noCost.storageGbMonths || 0),
    requestCounts: summary?.last30d?.requestCounts || {
      classA: 0,
      classB: 0,
      other: 0,
      total: 0,
    },
    estimatedMonthlyUsd: Number(estimate.estimatedMonthlyUsd || 0),
    bucketKind: summary?.bucketKind || "-",
    percentOfNoCost: {
      storage: Number(percent.storage || 0),
      download: Number(percent.download || 0),
      classA: Number(percent.classA || 0),
      classB: Number(percent.classB || 0),
    },
  };
}

function getOpenAISnapshot(openaiSummary) {
  const summary = openaiSummary || null;
  const budgetJpy = Number(summary?.budgetReference?.amountJpy || 0);
  const totalUsd = Number(summary?.totalUsd30d || 0);
  return {
    available: Boolean(summary?.available),
    totalUsd30d: totalUsd,
    latestDayUsd: Number(summary?.latestDayUsd || 0),
    budgetJpy,
    budgetStateText:
      budgetJpy > 0
        ? `${formatUsd(totalUsd, 2)} / ref ¥${budgetJpy.toLocaleString()}`
        : formatUsd(totalUsd, 2),
  };
}

function simplifyOpenAILineItemName(name) {
  return String(name || "")
    .replace(/-\d{4}-\d{2}-\d{2}/g, "")
    .replace(/,\s*/g, " / ")
    .trim();
}

function splitOpenAILineItemName(name) {
  const simplified = simplifyOpenAILineItemName(name);
  const parts = simplified
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const kind = parts.pop();
    return {
      model: parts.join(" / "),
      kind,
    };
  }
  return {
    model: simplified,
    kind: "",
  };
}

function roundUsd(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function formatOpenAILineItems14d(lineItems, usdToJpy) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const grouped = new Map();
  items.forEach((item) => {
    const { model, kind } = splitOpenAILineItemName(item?.name || "");
    const amountUsd = roundUsd(Number(item?.amountUsd || 0), 3);
    if (amountUsd <= 0) return;
    const key = model || "other";
    const existing = grouped.get(key) || { model: key, entries: [] };
    existing.entries.push({ kind: kind || "other", amountUsd });
    grouped.set(key, existing);
  });
  const charged = Array.from(grouped.values())
    .map((group) => {
      const entries = group.entries
        .map((entry) => ({
          kind: entry.kind,
          amountUsd: roundUsd(entry.amountUsd, 3),
          amountJpy: Math.round(roundUsd(entry.amountUsd, 3) * usdToJpy),
        }))
        .filter((entry) => entry.amountUsd > 0)
        .sort(
          (a, b) => b.amountUsd - a.amountUsd || a.kind.localeCompare(b.kind),
        );
      const totalUsd = roundUsd(
        entries.reduce((sum, entry) => sum + entry.amountUsd, 0),
        3,
      );
      return { model: group.model, totalUsd, entries };
    })
    .filter((item) => item.totalUsd > 0)
    .sort((a, b) => b.totalUsd - a.totalUsd || a.model.localeCompare(b.model));
  return charged.length ? charged : null;
}

function getRoughMonthlyCostSnapshot({
  storageSummary,
  openaiSummary,
  usdToJpy = 150,
}) {
  const storage = getStorageSnapshot(storageSummary);
  const openai = getOpenAISnapshot(openaiSummary);
  const storageUsd = Number(storage.estimatedMonthlyUsd || 0);
  const openaiUsd = openai.available ? Number(openai.totalUsd30d || 0) : 0;
  return {
    totalUsd: storageUsd + openaiUsd,
    storageUsd,
    openaiUsd,
    totalJpy: (storageUsd + openaiUsd) * usdToJpy,
    storageJpy: storageUsd * usdToJpy,
    openaiJpy: openaiUsd * usdToJpy,
    usdToJpy,
  };
}

function getMonthPaceInfo(baseDate = new Date()) {
  const date = new Date(baseDate);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return {
    dayOfMonth: day,
    daysInMonth,
    elapsedRatio: day / Math.max(1, daysInMonth),
    remainingDays: Math.max(0, daysInMonth - day),
  };
}

function buildCodexWeeklyTimingContext(codexSummary) {
  const fetchedAtISO = codexSummary?.fetchedAtISO || new Date().toISOString();
  const resetAtISO = codexSummary?.secondaryWindow?.resetAtISO || "";
  const fetched = new Date(fetchedAtISO);
  const reset = new Date(resetAtISO);
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const fetchedMs = fetched.getTime();
  const resetMs = reset.getTime();
  const diffMs =
    Number.isFinite(fetchedMs) && Number.isFinite(resetMs)
      ? Math.max(0, resetMs - fetchedMs)
      : NaN;
  const hours = Number.isFinite(diffMs) ? diffMs / (1000 * 60 * 60) : null;
  const days = Number.isFinite(diffMs) ? diffMs / (1000 * 60 * 60 * 24) : null;
  return {
    fetchedAtISO,
    currentWeekdayLocal: Number.isFinite(fetchedMs)
      ? weekdayNames[fetched.getDay()]
      : null,
    weeklyResetAtISO: resetAtISO || null,
    daysUntilWeeklyReset: Number.isFinite(days)
      ? Number(days.toFixed(2))
      : null,
    hoursUntilWeeklyReset: Number.isFinite(hours) ? Math.round(hours) : null,
  };
}

function buildUsageOverviewFallbackSummary({
  firestoreSummary,
  codexSummary,
  storageSummary,
  openaiSummary,
  roughCostSummary,
}) {
  const fsToday = getFirestoreTodaySnapshot(firestoreSummary);
  const codexSecondary = codexSummary?.secondaryWindow || null;
  const codexWeeklyTiming = buildCodexWeeklyTimingContext(codexSummary);
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
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
    Number(storagePercent.classB || 0),
  );
  const firestorePeak = Math.max(
    Number(fsToday?.ratePercent?.read || 0),
    Number(fsToday?.ratePercent?.write || 0),
    Number(fsToday?.ratePercent?.delete || 0),
  );

  return [
    `total: ¥${Math.round(Number(roughCostSummary?.totalJpy || 0))} / redline ¥3000 に対して ${Number(roughCostSummary?.totalJpy || 0) < 3000 ? "余裕あり" : "注意"}`,
    `codex: 1w used ${Math.round(Number(codexSecondary?.usedPercent || 0))}%、resetまで約${Math.max(0, Number(codexWeeklyTiming?.hoursUntilWeeklyReset || 0))}h`,
    openaiSummary?.available
      ? `openai: 月末見込み ¥${Math.round(openaiMonthEndJpy)}、現時点 ¥${Math.round(openaiTotalJpy)} (${dayOfMonth}/${daysInMonth})`
      : "openai: 利用額未取得",
    `storage: 無料枠ペース最大 ${storagePeak.toFixed(1)}% で ${storagePeak < 100 ? "枠内ペース" : "超過注意"}`,
    `firestore: 無料枠ペース最大 ${firestorePeak.toFixed(1)}% で ${firestorePeak < 100 ? "枠内ペース" : "超過注意"}`,
  ].join("\n");
}

function normalizeUsageOverviewSummary(summary, fallbackSummary) {
  const raw = String(summary || "").trim();
  if (!raw || raw.length < 20) return fallbackSummary;
  return raw;
}

function shouldUseAiUsageOverviewSummary() {
  return (
    String(process.env.USAGE_OVERVIEW_SUMMARY_MODE || "")
      .trim()
      .toLowerCase() === "ai"
  );
}

function getUsageOverviewSummaryModel() {
  const value = String(process.env.USAGE_OVERVIEW_SUMMARY_MODEL || "").trim();
  return value || "gpt-4o-mini";
}

function normalizeUsageOverviewSummaryProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return provider === "gemini" ? "gemini" : "openai";
}

function getUsageOverviewSummaryProvider() {
  return normalizeUsageOverviewSummaryProvider(
    process.env.USAGE_OVERVIEW_SUMMARY_PROVIDER,
  );
}

function parseModelList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferUsageOverviewSummaryProvider(
  model,
  fallbackProvider = getUsageOverviewSummaryProvider(),
) {
  const raw = String(model || "").trim().toLowerCase();
  if (/^(models\/)?gemini[-.]/.test(raw)) return "gemini";
  if (/^(gpt-|o\d|chatgpt-|chat-latest)/.test(raw)) return "openai";
  return normalizeUsageOverviewSummaryProvider(fallbackProvider);
}

function parseUsageOverviewSummaryModelSpec(
  value,
  fallbackProvider = getUsageOverviewSummaryProvider(),
) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(openai|gemini)[:/](.+)$/i);
  if (match) {
    return {
      provider: normalizeUsageOverviewSummaryProvider(match[1]),
      model: match[2].trim(),
    };
  }
  return {
    provider: inferUsageOverviewSummaryProvider(raw, fallbackProvider),
    model: raw,
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
    .map((model) =>
      parseUsageOverviewSummaryModelSpec(model, fallbackProvider),
    )
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

function getUsageOverviewSummaryModelLabel() {
  if (!shouldUseAiUsageOverviewSummary()) return "local-template(mode!=ai)";
  return getUsageOverviewSummaryModelChainLabel();
}

async function summarizeUsageOverviewWithOpenAI({
  firestoreSummary,
  codexSummary,
  storageSummary,
  openaiSummary,
  roughCostSummary,
}, options = {}) {
  const fallbackSummary = buildUsageOverviewFallbackSummary({
    firestoreSummary,
    codexSummary,
    storageSummary,
    openaiSummary,
    roughCostSummary,
  });
  if (!shouldUseAiUsageOverviewSummary()) {
    return { summary: fallbackSummary, model: "local-template(mode!=ai)" };
  }

  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    if (options.fallbackOnError === false) {
      throw new Error("OPENAI_API_KEY or OPENAI_KEY is not set.");
    }
    return { summary: fallbackSummary, model: "local-template(no-openai-key)" };
  }

  const fsToday = getFirestoreTodaySnapshot(firestoreSummary);
  const fsTrend = computeFirestore14dTrend(firestoreSummary);
  const codexSecondary = codexSummary?.secondaryWindow || null;
  const codexWeeklyTiming = buildCodexWeeklyTimingContext(codexSummary);
  const limits = firestoreSummary?.limitsDaily || {};
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const elapsedMonthRatio = dayOfMonth / Math.max(1, daysInMonth);
  const openaiTotalUsd30d = Number(
    openaiSummary?.available ? openaiSummary?.totalUsd30d || 0 : 0,
  );
  const storagePercent = storageSummary?.estimate?.percentOfNoCost || {};

  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: "You are a cloud service usage analyst. Analyze the usage data and output a concise Japanese paragraph (300-400 chars). Cover key metrics, cost anomalies, and optimization actions. No bullet points, no intro, no conclusion. 重要事項:codexは1週間周期のリセットを常に意識する。Openaiのusageは再重要事項。課金発生要因について必ず言及すること。",
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify(
            {
              totalCost: {
                roughTotalJpy: Number(
                  Number(roughCostSummary?.totalJpy || 0).toFixed(0),
                ),
                storageJpy: Number(
                  Number(roughCostSummary?.storageJpy || 0).toFixed(0),
                ),
                openaiJpy: Number(
                  Number(roughCostSummary?.openaiJpy || 0).toFixed(0),
                ),
                redlineJpy: 3000,
              },
              codex: {
                planType: codexSummary?.planType || null,
                usedPercent: Number(codexSecondary?.usedPercent ?? 0),
                remainingPercent: Number(codexSecondary?.remainingPercent ?? 0),
                hoursUntilReset:
                  codexWeeklyTiming?.hoursUntilWeeklyReset ?? null,
                resetAtISO: codexSecondary?.resetAtISO || null,
              },
              openai: {
                available: Boolean(openaiSummary?.available),
                dayOfMonth,
                daysInMonth,
                monthToDateJpy: Number(
                  Number(roughCostSummary?.openaiJpy || 0).toFixed(0),
                ),
                last14dUsd: Number(
                  Number(openaiSummary?.totalUsd14d || 0).toFixed(3),
                ),
                billedLineItems14d: Array.isArray(openaiSummary?.lineItems14d)
                  ? openaiSummary.lineItems14d.map((item) => ({
                      name: item.name,
                      amountUsd: Number(Number(item.amountUsd || 0).toFixed(3)),
                    }))
                  : [],
                projectedMonthEndJpy: openaiSummary?.available
                  ? Number(
                      (
                        openaiTotalUsd30d / Math.max(0.001, elapsedMonthRatio)
                      ).toFixed(0),
                    )
                  : null,
              },
              storage: {
                peakNoCostPercent: Math.max(
                  Number(storagePercent.storage || 0),
                  Number(storagePercent.download || 0),
                  Number(storagePercent.classA || 0),
                  Number(storagePercent.classB || 0),
                ),
                roughMonthlyOverageUsd: Number(
                  storageSummary?.estimate?.estimatedMonthlyUsd || 0,
                ),
              },
              firestore: {
                limitsDaily: {
                  read: Number(limits.read || 0),
                  write: Number(limits.write || 0),
                  delete: Number(limits.delete || 0),
                },
                todayRatePercent: fsToday.ratePercent,
                trend7d: {
                  read: Number(fsTrend.trend.read.avgRateLast7.toFixed(2)),
                  write: Number(fsTrend.trend.write.avgRateLast7.toFixed(2)),
                  delete: Number(fsTrend.trend.delete.avgRateLast7.toFixed(2)),
                },
                max14d: {
                  read: Number(fsTrend.trend.read.maxRate14d.toFixed(2)),
                  write: Number(fsTrend.trend.write.maxRate14d.toFixed(2)),
                  delete: Number(fsTrend.trend.delete.maxRate14d.toFixed(2)),
                },
              },
            },
            null,
            0,
          ),
        },
      ],
    },
  ];

  const models = Array.isArray(options.models)
    ? options.models.filter(Boolean)
    : getUsageOverviewSummaryModelsForProvider("openai");
  if (!models.length) {
    if (options.fallbackOnError === false) {
      throw new Error("No OpenAI usage overview summary models configured.");
    }
    return {
      summary: fallbackSummary,
      model: "local-template(no-openai-model)",
    };
  }
  const errors = [];
  for (const model of models) {
    try {
      const res = await fetch(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input,
          max_output_tokens: 260,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          payload?.error?.message || `OpenAI API error (${res.status})`,
        );
      const summary = extractOpenAIResponseText(payload);
      if (!summary)
        throw new Error("OpenAI response did not contain summary text.");
      return {
        summary: normalizeUsageOverviewSummary(summary, fallbackSummary),
        model,
      };
    } catch (error) {
      errors.push(`${model}: ${error?.message || String(error)}`);
    }
  }
  if (errors.length) {
    console.warn(`[usage-summary] OpenAI summarize fallback: ${errors.join(" | ")}`);
  }
  if (options.fallbackOnError === false) {
    throw new Error(errors.join(" | "));
  }
  return {
    summary: fallbackSummary,
    model: buildUsageOverviewAiErrorModelLabel(
      models.map((model) => `openai:${model}`),
    ),
  };
}

async function summarizeUsageOverviewWithGemini({
  firestoreSummary,
  codexSummary,
  storageSummary,
  openaiSummary,
  roughCostSummary,
}, options = {}) {
  const fallbackSummary = buildUsageOverviewFallbackSummary({
    firestoreSummary,
    codexSummary,
    storageSummary,
    openaiSummary,
    roughCostSummary,
  });
  if (!shouldUseAiUsageOverviewSummary()) {
    return { summary: fallbackSummary, model: "local-template(mode!=ai)" };
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    if (options.fallbackOnError === false) {
      throw new Error("GEMINI_API_KEY is not set.");
    }
    return { summary: fallbackSummary, model: "local-template(no-gemini-key)" };
  }

  const fsToday = getFirestoreTodaySnapshot(firestoreSummary);
  const fsTrend = computeFirestore14dTrend(firestoreSummary);
  const codexSecondary = codexSummary?.secondaryWindow || null;
  const codexWeeklyTiming = buildCodexWeeklyTimingContext(codexSummary);
  const limits = firestoreSummary?.limitsDaily || {};
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const elapsedMonthRatio = dayOfMonth / Math.max(1, daysInMonth);
  const openaiTotalUsd30d = Number(
    openaiSummary?.available ? openaiSummary?.totalUsd30d || 0 : 0,
  );
  const storagePercent = storageSummary?.estimate?.percentOfNoCost || {};
  const payloadInput = {
    totalCost: {
      roughTotalJpy: Number(Number(roughCostSummary?.totalJpy || 0).toFixed(0)),
      storageJpy: Number(Number(roughCostSummary?.storageJpy || 0).toFixed(0)),
      openaiJpy: Number(Number(roughCostSummary?.openaiJpy || 0).toFixed(0)),
      redlineJpy: 3000,
    },
    codex: {
      planType: codexSummary?.planType || null,
      usedPercent: Number(codexSecondary?.usedPercent ?? 0),
      remainingPercent: Number(codexSecondary?.remainingPercent ?? 0),
      hoursUntilReset: codexWeeklyTiming?.hoursUntilWeeklyReset ?? null,
      resetAtISO: codexSecondary?.resetAtISO || null,
    },
    openai: {
      available: Boolean(openaiSummary?.available),
      dayOfMonth,
      daysInMonth,
      monthToDateJpy: Number(Number(roughCostSummary?.openaiJpy || 0).toFixed(0)),
      last14dUsd: Number(Number(openaiSummary?.totalUsd14d || 0).toFixed(3)),
      projectedMonthEndJpy: openaiSummary?.available
        ? Number((openaiTotalUsd30d / Math.max(0.001, elapsedMonthRatio)).toFixed(0))
        : null,
    },
    storage: {
      peakNoCostPercent: Math.max(
        Number(storagePercent.storage || 0),
        Number(storagePercent.download || 0),
        Number(storagePercent.classA || 0),
        Number(storagePercent.classB || 0),
      ),
      roughMonthlyOverageUsd: Number(storageSummary?.estimate?.estimatedMonthlyUsd || 0),
    },
    firestore: {
      limitsDaily: {
        read: Number(limits.read || 0),
        write: Number(limits.write || 0),
        delete: Number(limits.delete || 0),
      },
      todayRatePercent: fsToday.ratePercent,
      trend7d: {
        read: Number(fsTrend.trend.read.avgRateLast7.toFixed(2)),
        write: Number(fsTrend.trend.write.avgRateLast7.toFixed(2)),
        delete: Number(fsTrend.trend.delete.avgRateLast7.toFixed(2)),
      },
      max14d: {
        read: Number(fsTrend.trend.read.maxRate14d.toFixed(2)),
        write: Number(fsTrend.trend.write.maxRate14d.toFixed(2)),
        delete: Number(fsTrend.trend.delete.maxRate14d.toFixed(2)),
      },
    },
  };
  const prompt = [
    "あなたはクラウドサービス利用状況のアナリストです。",
    "入力JSONを分析し、日本語の1段落（300-400文字）で要約してください。",
    "主要メトリクス、コスト異常の兆候、最優先の最適化アクションを含めてください。",
    "箇条書き、前置き、結論っぽい締めは禁止です。",
    "Codexは週次リセット前提で、resetまでの時間に必ず触れてください。",
    "OpenAI usageが取得できている場合は課金発生要因にも触れてください。",
    "",
    "INPUT(JSON):",
    JSON.stringify(payloadInput),
  ].join("\n");

  const models = Array.isArray(options.models)
    ? options.models.filter(Boolean)
    : getUsageOverviewSummaryModelsForProvider("gemini");
  if (!models.length) {
    if (options.fallbackOnError === false) {
      throw new Error("No Gemini usage overview summary models configured.");
    }
    return {
      summary: fallbackSummary,
      model: "local-template(no-gemini-model)",
    };
  }
  const errors = [];
  for (const model of models) {
    try {
      const res = await fetch(
        `${GEMINI_GENERATE_CONTENT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 },
          }),
        },
      );

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          payload?.error?.message || `Gemini API error (${res.status})`,
        );
      }
      const summary = extractGeminiResponseText(payload);
      if (!summary)
        throw new Error("Gemini response did not contain summary text.");
      return {
        summary: normalizeUsageOverviewSummary(summary, fallbackSummary),
        model,
      };
    } catch (error) {
      errors.push(`${model}: ${error?.message || String(error)}`);
    }
  }
  if (errors.length) {
    console.warn(`[usage-summary] Gemini summarize fallback: ${errors.join(" | ")}`);
  }
  if (options.fallbackOnError === false) {
    throw new Error(errors.join(" | "));
  }
  return {
    summary: fallbackSummary,
    model: buildUsageOverviewAiErrorModelLabel(
      models.map((model) => `gemini:${model}`),
    ),
  };
}

async function summarizeUsageOverview({
  firestoreSummary,
  codexSummary,
  storageSummary,
  openaiSummary,
  roughCostSummary,
}) {
  const fallbackSummary = buildUsageOverviewFallbackSummary({
    firestoreSummary,
    codexSummary,
    storageSummary,
    openaiSummary,
    roughCostSummary,
  });
  if (!shouldUseAiUsageOverviewSummary()) {
    return { summary: fallbackSummary, model: "local-template(mode!=ai)" };
  }

  const specs = getUsageOverviewSummaryModelSpecs();
  const errors = [];
  for (const spec of specs) {
    const args = {
      firestoreSummary,
      codexSummary,
      storageSummary,
      openaiSummary,
      roughCostSummary,
    };
    try {
      if (spec.provider === "gemini") {
        return await summarizeUsageOverviewWithGemini(args, {
          models: [spec.model],
          fallbackOnError: false,
        });
      }
      return await summarizeUsageOverviewWithOpenAI(args, {
        models: [spec.model],
        fallbackOnError: false,
      });
    } catch (error) {
      errors.push(
        `${formatUsageOverviewSummaryModelSpec(spec)}: ${error?.message || String(error)}`,
      );
    }
  }
  if (errors.length) {
    console.warn(`[usage-summary] usage overview summarize fallback: ${errors.join(" | ")}`);
  }
  return {
    summary: fallbackSummary,
    model: buildUsageOverviewAiErrorModelLabel(
      specs.map(formatUsageOverviewSummaryModelSpec),
    ),
  };
}

function quoteMarkdown(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => String(line).replace(/^\s*>\s?/, ""))
    .map((line) => `> ${line}`);
}

function quoteUsageOverviewSummaryModelLine(modelName) {
  const model = String(modelName || "").trim();
  if (!model) return [];
  return [`> model: \`${model.replace(/`/g, "'")}\``];
}

function buildUsageOverviewBody({
  firestoreSummary,
  codexSummary,
  storageSummary,
  openaiSummary,
  usageOverviewSummary,
  usageOverviewSummaryModel,
}) {
  return UsageOverviewShared.buildUsageOverviewBody({
    firestoreSummary,
    firestoreSnapshot: getFirestoreTodaySnapshot(firestoreSummary),
    firestoreActivitySnapshot: getFirestoreActivitySnapshot(firestoreSummary),
    storageSummary,
    storageSnapshot: getStorageSnapshot(storageSummary),
    openaiSummary,
    openaiSnapshot: getOpenAISnapshot(openaiSummary),
    codexSummary,
    roughCost: getRoughMonthlyCostSnapshot({
      storageSummary,
      openaiSummary,
    }),
    monthPace: getMonthPaceInfo(),
    usageOverviewSummary,
    usageOverviewSummaryModel,
    helpers: {
      formatJpy,
      formatUsd,
      formatBytes,
      formatNumberCompact,
      boldPercent,
      formatPeakPaceMetric,
      formatDuration,
      formatDate,
      quoteMarkdownLines: quoteMarkdown,
      quoteUsageOverviewSummaryModelLine,
      formatOpenAILineItems14d,
    },
  });
}

async function main() {
  const latest = loadLatest();
  const firestoreSummary = latest?.firestoreUsage || null;
  const codexSummary = latest?.codexUsage || null;
  const storageSummary = latest?.storageUsage || null;
  const openaiSummary = latest?.openaiCosts || null;
  const resetAtISO = codexSummary?.secondaryWindow?.resetAtISO || "";
  if (
    !firestoreSummary ||
    !codexSummary ||
    !storageSummary ||
    !openaiSummary ||
    !resetAtISO
  ) {
    throw new Error(
      "latest.json does not contain required usage tile payload.",
    );
  }

  const state = loadState();
  if (state.lastTriggeredResetAtISO === resetAtISO) {
    console.log(`Skip: already created for reset=${resetAtISO}`);
    return;
  }

  const savedAtISO = new Date().toISOString();
  const roughCostSummary = getRoughMonthlyCostSnapshot({
    storageSummary,
    openaiSummary,
  });
  let usageOverviewSummary = buildUsageOverviewFallbackSummary({
    firestoreSummary,
    codexSummary,
    storageSummary,
    openaiSummary,
    roughCostSummary,
  });
  let usageOverviewSummaryModel = getUsageOverviewSummaryModelLabel();
  try {
    const result = await summarizeUsageOverview({
      firestoreSummary,
      codexSummary,
      storageSummary,
      openaiSummary,
      roughCostSummary,
    });
    usageOverviewSummary = String(result.summary || "").trim();
    usageOverviewSummaryModel = String(result.model || "").trim() || getUsageOverviewSummaryModelLabel();
  } catch (error) {
    console.warn(
      `[usage-summary] usage overview summarize skipped: ${error?.message || String(error)}`,
    );
    usageOverviewSummaryModel = "local-template(ai-error)";
  }
  const memoBody = buildUsageOverviewBody({
    firestoreSummary,
    codexSummary,
    storageSummary,
    openaiSummary,
    usageOverviewSummary,
    usageOverviewSummaryModel,
  });
  const result = await saveMemoRecord({
    projectName: "usage",
    memoType: "memo",
    memoBody,
    threadTitle: `Firebase/Codex Usage - ${formatTitleDate(savedAtISO)}`,
    deletable: false,
    createdBy: "codex-tools-usage-trigger",
    sourceThread: process.cwd(),
  });

  saveState({
    ...state,
    lastTriggeredResetAtISO: resetAtISO,
    lastTriggeredAtISO: savedAtISO,
    lastDocId: result.docId,
  });

  console.log(`Created memo docId=${result.docId} resetAt=${resetAtISO}`);
}

module.exports = {
  buildUsageOverviewAiErrorModelLabel,
  formatUsageOverviewSummaryModelSpec,
  getUsageOverviewSummaryModelChainLabel,
  getUsageOverviewSummaryModelSpecs,
  getUsageOverviewSummaryModels,
  inferUsageOverviewSummaryProvider,
  parseUsageOverviewSummaryModelSpec,
  summarizeUsageOverview,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
