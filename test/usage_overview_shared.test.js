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
