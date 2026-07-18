const test = require("node:test");
const assert = require("node:assert/strict");

const UsageOverviewShared = require("../codex-memo-web/public/usage_overview_shared");

const refsLine = UsageOverviewShared.usageSourceFooterLines()[1];
const interactiveRefsLine =
  UsageOverviewShared.usageSourceFooterLines({ interactive: true })[1];

test("moves legacy footer refs to the start with one separator", () => {
  const body = ["rough monthly cost: **¥0**", "", refsLine].join("\n");

  assert.equal(
    UsageOverviewShared.moveUsageRefsToBodyStart(body),
    [refsLine, "", "rough monthly cost: **¥0**"].join("\n"),
  );
});

test("normalizes interactive refs that are already at the start", () => {
  const body = [interactiveRefsLine, "", "", "rough monthly cost: **¥0**"].join(
    "\n",
  );

  assert.equal(
    UsageOverviewShared.moveUsageRefsToBodyStart(body),
    [interactiveRefsLine, "", "rough monthly cost: **¥0**"].join("\n"),
  );
});

test("leaves bodies without usage refs unchanged", () => {
  const body = "rough monthly cost: **¥0**\n\n## Codex";

  assert.equal(UsageOverviewShared.moveUsageRefsToBodyStart(body), body);
});

test("builds new usage overview bodies with refs first", () => {
  const body = UsageOverviewShared.buildUsageOverviewBody({
    firestoreSnapshot: {},
    firestoreActivitySnapshot: {
      days: 0,
      read: { total: 0, avg: 0, peak: { value: 0, date: "-" } },
      write: { total: 0, avg: 0, peak: { value: 0, date: "-" } },
      delete: { total: 0, avg: 0, peak: { value: 0, date: "-" } },
    },
    storageSnapshot: {
      egressBytes30d: 0,
      requestCounts: { classA: 0, classB: 0 },
    },
    openaiSnapshot: {},
    roughCost: { totalJpy: 0, storageJpy: 0, openaiJpy: 0, usdToJpy: 150 },
    monthPace: { dayOfMonth: 1, daysInMonth: 30 },
    helpers: {
      formatJpy: (value) => `¥${value}`,
      formatUsd: (value) => `$${value}`,
      formatBytes: (value) => `${value} B`,
      formatNumberCompact: String,
      boldPercent: (value) => `**${value || 0}%**`,
      formatPeakPaceMetric: () => "-",
      formatDuration: () => "-",
      formatDate: () => "-",
      quoteMarkdownLines: () => [],
      quoteUsageOverviewSummaryModelLine: () => [],
      formatOpenAILineItems14d: () => [],
    },
  });

  assert.equal(body.split("\n")[0], refsLine);
  assert.equal(body.split("\n")[1], "");
});

test("marks legacy persisted usage overview bodies for rebuild", () => {
  const legacyBody = [
    refsLine,
    "",
    "rough monthly cost: **¥0** / line ¥3000",
    "",
    "## Codex",
    "",
    "- 5h remaining: **82%** reset: 2026-06-15T10:00:00.000Z",
    "- weekly remaining: **76%** reset: 2026-06-16T10:00:00.000Z",
  ].join("\n");

  assert.equal(
    UsageOverviewShared.usageOverviewBodyNeedsCurrentBuild(legacyBody),
    true,
  );
});

test("rebuilds persisted usage overview bodies that still show the 5h limit", () => {
  const currentBody = [
    refsLine,
    "",
    "rough monthly cost: **¥0** / line ¥3000",
    "",
    "## Codex",
    "",
    "- 5h remaining: **82%** reset: 2026-06-15T10:00:00.000Z",
    "- weekly remaining: **76%** reset: 2026-06-16T10:00:00.000Z",
    "- activity detail: token history not exposed in this session; 5h/1w limits above are current",
  ].join("\n");

  assert.equal(
    UsageOverviewShared.usageOverviewBodyNeedsCurrentBuild(currentBody),
    true,
  );
});

test("keeps weekly-only temporary usage overview bodies without rebuild", () => {
  const currentBody = [
    refsLine,
    "",
    "rough monthly cost: **¥0** / line ¥3000",
    "",
    "## Codex",
    "",
    "- 5h limit: temporarily lifted (GPT-5.6 launch measure)",
    "- 1w remaining: **76%** reset: 2026-06-16T10:00:00.000Z",
    "- activity detail: token history not exposed in this session; 1w limit above is current (5h temporarily lifted)",
  ].join("\n");

  assert.equal(
    UsageOverviewShared.usageOverviewBodyNeedsCurrentBuild(currentBody),
    false,
  );
});

test("exposes the temporary weekly-only policy to summary generators", () => {
  assert.deepEqual(UsageOverviewShared.getCodexLimitPolicy(), {
    version: "gpt-5.6-weekly-only-temporary-v1",
    fiveHourLimitStatus: "temporarily_lifted",
    activeLimitWindow: "1w",
    reason: "GPT-5.6 launch measure",
    summaryInstruction:
      "重要: GPT-5.6開始に伴う一時措置で5h limitは解除中。Codexの残量判断は1w limitのみを使い、5h値は要約に使わない。",
  });
});

test("uses a weekly primary window when the temporary API omits secondary", () => {
  const weekly = {
    limitWindowSeconds: 604800,
    remainingPercent: 84,
    resetAtISO: "2026-07-25T03:35:59.000Z",
  };

  assert.equal(
    UsageOverviewShared.getCodexWeeklyWindow({
      primaryWindow: weekly,
      secondaryWindow: null,
    }),
    weekly,
  );
});

test("summarizes Codex activity from token usage buckets", () => {
  const activity = UsageOverviewShared.getCodexActivitySnapshot({
    tokenUsage: {
      summary: {
        lifetimeTokens: 123456,
        peakDailyTokens: 50000,
        longestRunningTurnSec: 3720,
        currentStreakDays: 3,
        longestStreakDays: 9,
      },
      dailyUsageBuckets: [
        { date: "2026-06-08", tokens: 10 },
        { date: "2026-06-09", tokens: 20 },
        { date: "2026-06-10", tokens: 30 },
        { date: "2026-06-11", tokens: 40 },
        { date: "2026-06-12", tokens: 50 },
        { date: "2026-06-13", tokens: 60 },
        { date: "2026-06-14", tokens: 70 },
        { date: "2026-06-15", tokens: 80 },
      ],
    },
  });

  assert.equal(activity.available, true);
  assert.equal(activity.latestDate, "2026-06-15");
  assert.equal(activity.todayTokens, 80);
  assert.equal(activity.recent7dTokens, 350);
  assert.equal(activity.lifetimeTokens, 123456);
  assert.equal(activity.dailyRowsDesc[0].date, "2026-06-15");
});

test("shows only the active 1w limit while adding activity to overview body", () => {
  const body = UsageOverviewShared.buildUsageOverviewBody({
    codexSummary: {
      planType: "plus",
      limitId: "codex",
      primaryWindow: {
        remainingPercent: 82,
        usedPercent: 18,
        resetAtISO: "2026-06-15T10:00:00.000Z",
      },
      secondaryWindow: {
        remainingPercent: 76,
        usedPercent: 24,
        resetAfterSeconds: 7200,
        resetAtISO: "2026-06-16T10:00:00.000Z",
      },
      tokenUsage: {
        summary: { lifetimeTokens: 1000 },
        dailyUsageBuckets: [{ date: "2026-06-15", tokens: 250 }],
      },
    },
    firestoreSnapshot: {},
    firestoreActivitySnapshot: {
      days: 0,
      read: { total: 0, avg: 0, peak: { value: 0, date: "-" } },
      write: { total: 0, avg: 0, peak: { value: 0, date: "-" } },
      delete: { total: 0, avg: 0, peak: { value: 0, date: "-" } },
    },
    storageSnapshot: {
      egressBytes30d: 0,
      requestCounts: { classA: 0, classB: 0 },
    },
    openaiSnapshot: {},
    roughCost: { totalJpy: 0, storageJpy: 0, openaiJpy: 0, usdToJpy: 150 },
    monthPace: { dayOfMonth: 1, daysInMonth: 30 },
    helpers: {
      formatJpy: (value) => `¥${value}`,
      formatUsd: (value) => `$${value}`,
      formatBytes: (value) => `${value} B`,
      formatNumberCompact: String,
      boldPercent: (value) => `**${value || 0}%**`,
      formatPeakPaceMetric: () => "-",
      formatDuration: (seconds) => `${seconds}s`,
      formatDate: (value) => value || "-",
      quoteMarkdownLines: () => [],
      quoteUsageOverviewSummaryModelLine: () => [],
      formatOpenAILineItems14d: () => [],
    },
  });

  assert.match(body, /- 5h limit: temporarily lifted \(GPT-5\.6 launch measure\)/);
  assert.match(body, /- 1w remaining: \*\*76%\*\* reset: 2026-06-16T10:00:00.000Z/);
  assert.match(body, /- 1w resetまで: 7200s \/ used \*\*24%\*\*/);
  assert.doesNotMatch(body, /- 5h remaining:/);
  assert.match(body, /- activity \(\/usage\): daily 250 tokens \(2026-06-15\) \/ 7d 250 \/ lifetime 1000/);
  assert.match(body, /\| 2026-06-15 \| 250 \|/);
});

test("keeps the active 1w reset without an empty activity table when token history is unavailable", () => {
  const body = UsageOverviewShared.buildUsageOverviewBody({
    codexSummary: {
      planType: "plus",
      limitId: "codex",
      primaryWindow: {
        remainingPercent: 52,
        usedPercent: 48,
        limitWindowSeconds: 604800,
        resetAfterSeconds: 68640,
        resetAtISO: "2026-06-18T05:02:00.000Z",
      },
      secondaryWindow: null,
    },
    firestoreSnapshot: {},
    firestoreActivitySnapshot: {
      days: 0,
      read: { total: 0, avg: 0, peak: { value: 0, date: "-" } },
      write: { total: 0, avg: 0, peak: { value: 0, date: "-" } },
      delete: { total: 0, avg: 0, peak: { value: 0, date: "-" } },
    },
    storageSnapshot: {
      egressBytes30d: 0,
      requestCounts: { classA: 0, classB: 0 },
    },
    openaiSnapshot: {},
    roughCost: { totalJpy: 0, storageJpy: 0, openaiJpy: 0, usdToJpy: 150 },
    monthPace: { dayOfMonth: 1, daysInMonth: 30 },
    helpers: {
      formatJpy: (value) => `¥${value}`,
      formatUsd: (value) => `$${value}`,
      formatBytes: (value) => `${value} B`,
      formatNumberCompact: String,
      boldPercent: (value) => `**${value || 0}%**`,
      formatPeakPaceMetric: () => "-",
      formatDuration: (seconds) => `${seconds}s`,
      formatDate: (value) => value || "-",
      quoteMarkdownLines: () => [],
      quoteUsageOverviewSummaryModelLine: () => [],
      formatOpenAILineItems14d: () => [],
    },
  });

  const codexSection = body.split("\n## OpenAI API\n")[0];
  assert.match(codexSection, /- 5h limit: temporarily lifted \(GPT-5\.6 launch measure\)/);
  assert.match(codexSection, /- 1w remaining: \*\*52%\*\* reset: 2026-06-18T05:02:00.000Z/);
  assert.match(codexSection, /- activity detail: token history not exposed in this session; 1w limit above is current \(5h temporarily lifted\)/);
  assert.doesNotMatch(codexSection, /- 5h remaining:/);
  assert.doesNotMatch(codexSection, /not available/);
  assert.doesNotMatch(codexSection, /Codex activity 14d/);
  assert.doesNotMatch(codexSection, /\| - \| - \|/);
});
