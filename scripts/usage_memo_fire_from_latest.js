#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { saveMemoRecord } = require("./codex_memo_core");
const { loadEnvFromCandidates } = require("./load_env");

const LATEST_PATH = path.join(process.cwd(), "dist", "usage-reports", "weekly", "latest.json");
const STATE_PATH = path.join(process.cwd(), "dist", "usage-reports", "weekly", ".memo-trigger-state.json");
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

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

function getFirestoreTodaySnapshot(firestoreSummary) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const perDay = Array.isArray(firestoreSummary?.perDay) ? firestoreSummary.perDay : [];
  const today = perDay.find((d) => d.date === todayKey) || perDay[perDay.length - 1] || { read: 0, write: 0, delete: 0, date: todayKey };
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

function computeFirestore14dTrend(firestoreSummary) {
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
      latest: Number(latest?.[key] || 0),
      prev: Number(prev?.[key] || 0),
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
  return { last14, latest, prev, trend };
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
  if (!apiKey) return null;

  const fsToday = getFirestoreTodaySnapshot(firestoreSummary);
  const fsTrend = computeFirestore14dTrend(firestoreSummary);
  const codexPrimary = codexSummary?.primaryWindow || null;
  const codexSecondary = codexSummary?.secondaryWindow || null;
  const codexWeeklyTiming = buildCodexWeeklyTimingContext(codexSummary);
  const limits = firestoreSummary?.limitsDaily || {};

  const summaryInput = {
    firestore: {
      focus: "free-tier usage rate",
      last14DaysChange: true,
      latestDateUTC: fsTrend.latest?.date || null,
      limitsDaily: {
        read: Number(limits.read || 0),
        write: Number(limits.write || 0),
        delete: Number(limits.delete || 0)
      },
      todayRatePercentOfFreeTier: fsToday.ratePercent,
      dailyRate14d: {
        latest: {
          read: Number(formatNumber(fsTrend.trend.read.latestRate, 3)),
          write: Number(formatNumber(fsTrend.trend.write.latestRate, 3)),
          delete: Number(formatNumber(fsTrend.trend.delete.latestRate, 3))
        },
        latestVsPrevDelta: {
          read: Number(formatNumber(fsTrend.trend.read.deltaRateDay, 3)),
          write: Number(formatNumber(fsTrend.trend.write.deltaRateDay, 3)),
          delete: Number(formatNumber(fsTrend.trend.delete.deltaRateDay, 3))
        },
        avgFirst7: {
          read: Number(formatNumber(fsTrend.trend.read.avgRateFirst7, 3)),
          write: Number(formatNumber(fsTrend.trend.write.avgRateFirst7, 3)),
          delete: Number(formatNumber(fsTrend.trend.delete.avgRateFirst7, 3))
        },
        avgLast7: {
          read: Number(formatNumber(fsTrend.trend.read.avgRateLast7, 3)),
          write: Number(formatNumber(fsTrend.trend.write.avgRateLast7, 3)),
          delete: Number(formatNumber(fsTrend.trend.delete.avgRateLast7, 3))
        },
        avgDeltaLast7MinusFirst7: {
          read: Number(formatNumber(fsTrend.trend.read.deltaAvgRate, 3)),
          write: Number(formatNumber(fsTrend.trend.write.deltaAvgRate, 3)),
          delete: Number(formatNumber(fsTrend.trend.delete.deltaAvgRate, 3))
        },
        max14d: {
          read: Number(formatNumber(fsTrend.trend.read.maxRate14d, 3)),
          write: Number(formatNumber(fsTrend.trend.write.maxRate14d, 3)),
          delete: Number(formatNumber(fsTrend.trend.delete.maxRate14d, 3))
        }
      },
      avgPerDayFirst7: {
        read: Number(formatNumber(fsTrend.trend.read.avgFirst7, 2)),
        write: Number(formatNumber(fsTrend.trend.write.avgFirst7, 2)),
        delete: Number(formatNumber(fsTrend.trend.delete.avgFirst7, 2))
      },
      avgPerDayLast7: {
        read: Number(formatNumber(fsTrend.trend.read.avgLast7, 2)),
        write: Number(formatNumber(fsTrend.trend.write.avgLast7, 2)),
        delete: Number(formatNumber(fsTrend.trend.delete.avgLast7, 2))
      },
      avgDeltaLast7MinusFirst7: {
        read: Number(formatNumber(fsTrend.trend.read.deltaAvg, 2)),
        write: Number(formatNumber(fsTrend.trend.write.deltaAvg, 2)),
        delete: Number(formatNumber(fsTrend.trend.delete.deltaAvg, 2))
      },
      latestVsPrevDayDelta: {
        read: fsTrend.trend.read.deltaDay,
        write: fsTrend.trend.write.deltaDay,
        delete: fsTrend.trend.delete.deltaDay
      }
    },
    codex: {
      focus: "1w remaining and usage rate, aligned with firebase 'usage rate' perspective",
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
  };

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
          text: JSON.stringify(summaryInput, null, 2)
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
  return summary;
}

function quoteMarkdown(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => `> ${line}`);
}

function buildUsageOverviewBody(firestoreSummary, codexSummary, aiSummary) {
  const fs = getFirestoreTodaySnapshot(firestoreSummary);
  const codexPrimary = codexSummary?.primaryWindow || null;
  const codexSecondary = codexSummary?.secondaryWindow || null;
  const fetchedAtISO = codexSummary?.fetchedAtISO || firestoreSummary?.endTime || "";
  const fsPerDay = Array.isArray(firestoreSummary?.perDay) ? firestoreSummary.perDay : [];
  const fs14Desc = [...fsPerDay]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 14);

  const lines = [`<small>fetched: ${formatDate(fetchedAtISO)}</small>`];
  if (aiSummary) {
    lines.push(...quoteMarkdown(aiSummary));
  }
  lines.push(
    "",
    "## Codex",
    "",
    `- 5h remaining: ${boldPercent(codexPrimary?.remainingPercent, 0)} reset: ${formatDate(codexPrimary?.resetAtISO)}`,
    `- weekly remaining: ${boldPercent(codexSecondary?.remainingPercent, 0)} reset: ${formatDate(codexSecondary?.resetAtISO)}`,
    "",
    "## Firestore",
    "",
    `- free-tier: R ${boldPercent(fs.ratePercent.read, 1)} / W ${boldPercent(fs.ratePercent.write, 1)} / D ${boldPercent(fs.ratePercent.delete, 1)}`,
    `- vs 14d max: R ${boldPercent(fs.relativePercent.read, 0)} / W ${boldPercent(fs.relativePercent.write, 0)} / D ${boldPercent(fs.relativePercent.delete, 0)}`,
    "",
    "### Firestore 14d details",
    "",
    "| date (UTC) | read | write | delete | total |",
    "| --- | ---: | ---: | ---: | ---: |"
  );

  for (const day of fs14Desc) {
    lines.push(`| ${day.date || "-"} | ${day.read || 0} | ${day.write || 0} | ${day.delete || 0} | ${day.total || 0} |`);
  }

  return lines.join("\n");
}

async function main() {
  const latest = loadLatest();
  const firestoreSummary = latest?.firestoreUsage || null;
  const codexSummary = latest?.codexUsage || null;
  const resetAtISO = codexSummary?.secondaryWindow?.resetAtISO || "";
  if (!firestoreSummary || !codexSummary || !resetAtISO) {
    throw new Error("latest.json does not contain required firestore/codex usage payload.");
  }

  const state = loadState();
  if (state.lastTriggeredResetAtISO === resetAtISO) {
    console.log(`Skip: already created for reset=${resetAtISO}`);
    return;
  }

  const savedAtISO = new Date().toISOString();
  let aiSummary = null;
  try {
    aiSummary = await summarizeUsageOverviewWithOpenAI({ firestoreSummary, codexSummary });
  } catch (error) {
    console.warn(`[usage-summary] OpenAI summarize skipped: ${error?.message || String(error)}`);
  }
  const memoBody = buildUsageOverviewBody(firestoreSummary, codexSummary, aiSummary);
  const result = await saveMemoRecord({
    projectName: "usage",
    memoType: "memo",
    memoBody,
    threadTitle: `Firebase/Codex Usage - ${formatTitleDate(savedAtISO)}`,
    deletable: false,
    createdBy: "codex-tools-usage-trigger",
    sourceThread: process.cwd()
  });

  saveState({
    ...state,
    lastTriggeredResetAtISO: resetAtISO,
    lastTriggeredAtISO: savedAtISO,
    lastDocId: result.docId
  });

  console.log(`Created memo docId=${result.docId} resetAt=${resetAtISO}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
