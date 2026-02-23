#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { saveMemoRecord } = require("./codex_memo_core");

const LATEST_PATH = path.join(process.cwd(), "dist", "usage-reports", "weekly", "latest.json");
const STATE_PATH = path.join(process.cwd(), "dist", "usage-reports", "weekly", ".memo-trigger-state.json");

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

function buildUsageOverviewBody(firestoreSummary, codexSummary) {
  const fs = getFirestoreTodaySnapshot(firestoreSummary);
  const codexPrimary = codexSummary?.primaryWindow || null;
  const codexSecondary = codexSummary?.secondaryWindow || null;
  const fetchedAtISO = codexSummary?.fetchedAtISO || firestoreSummary?.endTime || "";
  const fsPerDay = Array.isArray(firestoreSummary?.perDay) ? firestoreSummary.perDay : [];
  const fs14Desc = [...fsPerDay]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 14);

  const lines = [
    `<small>fetched: ${formatDate(fetchedAtISO)}</small>`,
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
  ];

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
  const memoBody = buildUsageOverviewBody(firestoreSummary, codexSummary);
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
