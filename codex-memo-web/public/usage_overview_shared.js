(function initUsageOverviewShared(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.UsageOverviewShared = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function usageOverviewSharedFactory() {
  "use strict";

  // Temporary GPT-5.6 launch measure. Set this back to false when the 5h limit returns.
  const CODEX_5H_LIMIT_TEMPORARILY_LIFTED = true;
  const CODEX_LIMIT_POLICY = Object.freeze(
    CODEX_5H_LIMIT_TEMPORARILY_LIFTED
      ? {
          version: "gpt-5.6-weekly-only-temporary-v1",
          fiveHourLimitStatus: "temporarily_lifted",
          activeLimitWindow: "1w",
          reason: "GPT-5.6 launch measure",
          summaryInstruction:
            "重要: GPT-5.6開始に伴う一時措置で5h limitは解除中。Codexの残量判断は1w limitのみを使い、5h値は要約に使わない。",
        }
      : {
          version: "standard-5h-and-1w-v1",
          fiveHourLimitStatus: "active",
          activeLimitWindow: "5h_and_1w",
          reason: "standard limits",
          summaryInstruction:
            "重要: Codexは5hと1wの両limitが適用され、週次resetまでの時間に必ず触れる。",
        },
  );

  const USAGE_REF_LINKS = Object.freeze([
    Object.freeze({
      key: "firestore",
      label: "firestore usage",
      url: "https://console.firebase.google.com/project/hush-pointer/firestore/databases/-default-/usage/prev-24h",
    }),
    Object.freeze({
      key: "storage",
      label: "storage",
      url: "https://console.firebase.google.com/project/hush-pointer/storage",
    }),
    Object.freeze({
      key: "gcpBilling",
      label: "gcp billing",
      url: "https://console.cloud.google.com/billing/reports",
    }),
    Object.freeze({
      key: "codex",
      label: "codex usage",
      url: "https://chatgpt.com/codex/settings/usage",
    }),
    Object.freeze({
      key: "openai",
      label: "openai usage",
      url: "https://platform.openai.com/usage",
    }),
    Object.freeze({
      key: "aiStudio",
      label: "ai studio rate limits",
      url: "https://aistudio.google.com/rate-limit?timeRange=last-1-days",
    }),
  ]);

  function getUsageRefPageUrls() {
    return USAGE_REF_LINKS.map((link) => link.url);
  }

  function getCodexLimitPolicy() {
    return CODEX_LIMIT_POLICY;
  }

  function getCodexWeeklyWindow(codexSummary) {
    const secondary = codexSummary?.secondaryWindow || null;
    if (secondary) return secondary;

    const primary = codexSummary?.primaryWindow || null;
    if (!primary) return null;
    const isWeeklyDuration =
      Number(primary.limitWindowSeconds || 0) >= 6 * 24 * 60 * 60;
    return CODEX_5H_LIMIT_TEMPORARILY_LIFTED || isWeeklyDuration
      ? primary
      : null;
  }

  function formatUsageRefLinks() {
    return USAGE_REF_LINKS.map((link) => `[${link.label}](${link.url})`).join(
      " | ",
    );
  }

  function usageSourceFooterLines(options = {}) {
    const refsLabel = options.interactive
      ? '<a href="#" class="usage-refs-trigger" data-open-usage-refs="1">refs:</a>'
      : "refs:";
    return ["", `<small>${refsLabel} ${formatUsageRefLinks()}</small>`];
  }

  function usageSourceHeaderLines(options = {}) {
    const [, refsLine] = usageSourceFooterLines(options);
    return [refsLine, ""];
  }

  function moveUsageRefsToBodyStart(body) {
    const lines = String(body || "").split("\n");
    const refsIndex = lines.findIndex((line) =>
      /^<small>\s*(?:<a\b[^>]*>)?refs:(?:<\/a>)?\s/.test(line.trim()),
    );
    if (refsIndex < 0) return lines.join("\n");

    const [refsLine] = lines.splice(refsIndex, 1);
    if (refsIndex < lines.length && lines[refsIndex].trim() === "") {
      lines.splice(refsIndex, 1);
    }
    if (refsIndex > 0 && lines[refsIndex - 1].trim() === "") {
      lines.splice(refsIndex - 1, 1);
    }
    while (lines[0]?.trim() === "") lines.shift();
    return [refsLine.trim(), "", ...lines].join("\n").trimEnd();
  }

  function getCodexActivitySnapshot(codexSummary) {
    const tokenUsage = codexSummary?.tokenUsage || null;
    const dailyRows = Array.isArray(tokenUsage?.dailyUsageBuckets)
      ? tokenUsage.dailyUsageBuckets
          .map((row) => ({
            date: String(row?.date || row?.startDate || "").slice(0, 10),
            tokens: Number(row?.tokens || 0),
          }))
          .filter((row) => row.date && Number.isFinite(row.tokens))
          .sort((a, b) => a.date.localeCompare(b.date))
      : [];
    const summary = tokenUsage?.summary || {};
    const recent7 = dailyRows.slice(-7);
    const recent14 = dailyRows.slice(-14);
    const sumTokens = (rows) =>
      rows.reduce((sum, row) => sum + Number(row.tokens || 0), 0);
    const latest = dailyRows[dailyRows.length - 1] || null;
    const peakFromRows = dailyRows.reduce(
      (peak, row) => Math.max(peak, Number(row.tokens || 0)),
      0,
    );
    const lifetimeFromRows = sumTokens(dailyRows);
    return {
      available: Boolean(tokenUsage),
      latestDate: latest?.date || "",
      todayTokens: Number(latest?.tokens || 0),
      recent7dTokens: sumTokens(recent7),
      recent14dTokens: sumTokens(recent14),
      lifetimeTokens: Number(summary.lifetimeTokens ?? lifetimeFromRows ?? 0),
      peakDailyTokens: Number(summary.peakDailyTokens ?? peakFromRows ?? 0),
      longestRunningTurnSec: Number(summary.longestRunningTurnSec || 0),
      currentStreakDays: Number(summary.currentStreakDays || 0),
      longestStreakDays: Number(summary.longestStreakDays || 0),
      dailyRowsDesc: [...recent14].sort((a, b) =>
        String(b.date || "").localeCompare(String(a.date || "")),
      ),
    };
  }

  function usageOverviewBodyNeedsCurrentBuild(visibleBody) {
    const body = String(visibleBody || "");
    const hasCodexActivityLine =
      body.includes("activity (/usage)") || body.includes("activity detail:");
    const hasCurrentLimitPolicy = CODEX_5H_LIMIT_TEMPORARILY_LIFTED
      ? body.includes("- 5h limit: temporarily lifted (GPT-5.6 launch measure)") &&
        body.includes("- 1w remaining:")
      : body.includes("- 5h remaining:") &&
        body.includes("- weekly remaining:");
    return (
      !hasCodexActivityLine ||
      !hasCurrentLimitPolicy ||
      body.includes("activity (/usage): not available") ||
      body.includes(
        "### Codex activity 14d\n\n| date | tokens |\n| --- | ---: |\n| - | - |",
      )
    );
  }

  function requireHelper(helpers, name) {
    const fn = helpers?.[name];
    if (typeof fn !== "function") {
      throw new Error(`Missing usage overview helper: ${name}`);
    }
    return fn;
  }

  function buildUsageOverviewBody(input = {}) {
    const helpers = input.helpers || {};
    const formatJpy = requireHelper(helpers, "formatJpy");
    const formatUsd = requireHelper(helpers, "formatUsd");
    const formatBytes = requireHelper(helpers, "formatBytes");
    const formatNumberCompact = requireHelper(helpers, "formatNumberCompact");
    const boldPercent = requireHelper(helpers, "boldPercent");
    const formatPeakPaceMetric = requireHelper(helpers, "formatPeakPaceMetric");
    const formatDuration = requireHelper(helpers, "formatDuration");
    const formatDate = requireHelper(helpers, "formatDate");
    const quoteMarkdownLines = requireHelper(helpers, "quoteMarkdownLines");
    const quoteSummaryModelLine = requireHelper(
      helpers,
      "quoteUsageOverviewSummaryModelLine",
    );
    const formatOpenAILineItems14d = requireHelper(
      helpers,
      "formatOpenAILineItems14d",
    );

    const {
      firestoreSummary,
      firestoreError,
      firestoreSnapshot,
      firestoreActivitySnapshot,
      storageSummary,
      storageError,
      storageSnapshot,
      openaiSummary,
      openaiError,
      openaiSnapshot,
      codexSummary,
      codexError,
      roughCost,
      monthPace,
      usageOverviewSummary,
      usageOverviewSummaryModel,
      interactiveRefs = false,
    } = input;

    const fs = firestoreSnapshot;
    const fsActivity = firestoreActivitySnapshot;
    const storage = storageSnapshot;
    const openai = openaiSnapshot;
    const codexPrimary = codexSummary?.primaryWindow || null;
    const codexSecondary = getCodexWeeklyWindow(codexSummary);
    const codexActivity = getCodexActivitySnapshot(codexSummary);
    const codexLimitLabel =
      codexSummary?.limitName || codexSummary?.limitId || "codex";
    const codexWindowLines = CODEX_5H_LIMIT_TEMPORARILY_LIFTED
      ? [
          "- 5h limit: temporarily lifted (GPT-5.6 launch measure)",
          codexSummary
            ? `- 1w remaining: ${boldPercent(codexSecondary?.remainingPercent, 0)} reset: ${formatDate(codexSecondary?.resetAtISO)}`
            : "- 1w remaining: -",
          codexSummary
            ? `- 1w resetまで: ${formatDuration(codexSecondary?.resetAfterSeconds || 0)} / used ${boldPercent(codexSecondary?.usedPercent, 0)}`
            : "- 1w resetまで: -",
        ]
      : [
          codexSummary
            ? `- 5h remaining: ${boldPercent(codexPrimary?.remainingPercent, 0)} reset: ${formatDate(codexPrimary?.resetAtISO)}`
            : "- 5h remaining: -",
          codexSummary
            ? `- weekly remaining: ${boldPercent(codexSecondary?.remainingPercent, 0)} reset: ${formatDate(codexSecondary?.resetAtISO)}`
            : "- weekly remaining: -",
          codexSummary
            ? `- next resetまで: ${formatDuration(codexSecondary?.resetAfterSeconds || 0)} / used ${boldPercent(codexSecondary?.usedPercent, 0)}`
            : "- next resetまで: -",
        ];
    const openaiRecentUsd = Number(openaiSummary?.totalUsd14d || 0);
    const openaiRecentJpy = openaiRecentUsd * roughCost.usdToJpy;
    const openaiLineItems14d = formatOpenAILineItems14d(
      openaiSummary?.lineItems14d,
      roughCost.usdToJpy,
    );
    const fsPerDay = Array.isArray(firestoreSummary?.perDay)
      ? firestoreSummary.perDay
      : [];
    const fs14Desc = [...fsPerDay]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 14);

    const lines = [
      ...usageSourceHeaderLines({ interactive: interactiveRefs }),
      `rough monthly cost: **${formatJpy(roughCost.totalJpy, 0)}** / line ¥3000 (Storage ${formatJpy(roughCost.storageJpy, 0)} + OpenAI ${formatJpy(roughCost.openaiJpy, 0)})`,
    ];
    if (usageOverviewSummary) {
      lines.push("");
      lines.push(...quoteMarkdownLines(usageOverviewSummary));
      lines.push(...quoteSummaryModelLine(usageOverviewSummaryModel));
    }
    lines.push(
      "",
      "## Codex",
      "",
      ...(codexSummary
        ? codexWindowLines
        : [
            `- status: ${codexError ? `error (${codexError})` : "loading"}`,
            ...codexWindowLines,
          ]),
      codexSummary ? `- limit: ${codexLimitLabel}` : "- limit: -",
    );

    if (codexActivity.available) {
      lines.push(
        `- activity (/usage): daily ${formatNumberCompact(codexActivity.todayTokens)} tokens (${codexActivity.latestDate || "-"}) / 7d ${formatNumberCompact(codexActivity.recent7dTokens)} / lifetime ${formatNumberCompact(codexActivity.lifetimeTokens)}`,
        `- streak: current ${codexActivity.currentStreakDays || 0}d / longest ${codexActivity.longestStreakDays || 0}d / longest turn ${formatDuration(codexActivity.longestRunningTurnSec || 0)}`,
        "",
        "### Codex activity 14d",
        "",
        "| date | tokens |",
        "| --- | ---: |",
      );
      for (const row of codexActivity.dailyRowsDesc) {
        lines.push(`| ${row.date} | ${formatNumberCompact(row.tokens)} |`);
      }
    } else {
      lines.push(
        CODEX_5H_LIMIT_TEMPORARILY_LIFTED
          ? "- activity detail: token history not exposed in this session; 1w limit above is current (5h temporarily lifted)"
          : "- activity detail: token history not exposed in this session; 5h/1w limits above are current",
      );
    }

    lines.push(
      "",
      "## OpenAI API",
      "",
      openaiSummary
        ? openai.available
          ? `- month cost: **${formatJpy(roughCost.openaiJpy, 0)}** / day ${monthPace.dayOfMonth}/${monthPace.daysInMonth}`
          : `- status: unavailable (${openaiSummary?.reason || "-"})`
        : `- status: ${openaiError ? `error (${openaiError})` : "loading"}`,
      openaiSummary && openai.available
        ? `- last 14d spend: **${formatUsd(openaiRecentUsd, 3)}** (${formatJpy(openaiRecentJpy, 0)})`
        : "- last 14d spend: -",
      "",
      "## Firestore",
      "",
      firestoreSummary
        ? `- today free-tier: R ${boldPercent(fs.ratePercent.read, 1)} / W ${boldPercent(fs.ratePercent.write, 1)} / D ${boldPercent(fs.ratePercent.delete, 1)}`
        : `- status: ${firestoreError ? `error (${firestoreError})` : "loading"}`,
      firestoreSummary
        ? `- vs 14d peak: ${formatPeakPaceMetric("R", fs.relativePercent.read)} / ${formatPeakPaceMetric("W", fs.relativePercent.write)} / ${formatPeakPaceMetric("D", fs.relativePercent.delete)}`
        : "- vs 14d peak: -",
      "",
      "## Storage",
      "",
      storageSummary
        ? `- now: ${formatBytes(storage.bytes)} / objects ${formatNumberCompact(storage.objects)}`
        : `- status: ${storageError ? `error (${storageError})` : "loading"}`,
      storageSummary
        ? `- no-cost: storage ${boldPercent(storage.percentOfNoCost.storage, 1)} / egress ${boldPercent(storage.percentOfNoCost.download, 1)} / A ${boldPercent(storage.percentOfNoCost.classA, 1)} / B ${boldPercent(storage.percentOfNoCost.classB, 1)}`
        : "- no-cost: -",
      storageSummary
        ? `- 30d pace: egress ${formatBytes(storage.egressBytes30d)} / rough overage ${formatJpy(roughCost.storageJpy, 0)} mo`
        : "- 30d pace: -",
      "- note: no-cost percentages are profile estimates; region/SKU eligibility and actual GCP charges are not included",
      "",
      "## Google Cloud usage sense",
      "",
      `- measured here: Firestore operations (${fsActivity.days || 0}d) / Storage activity (30d)`,
      "- not measured here: Cloud Run / Artifact Registry / Logging / Monitoring / Secret Manager / Cloud Build / actual GCP billing",
      "",
      "| signal | window total | daily avg | peak |",
      "| --- | ---: | ---: | --- |",
      `| Firestore reads | ${formatNumberCompact(fsActivity.read.total)} | ${formatNumberCompact(fsActivity.read.avg)} | ${formatNumberCompact(fsActivity.read.peak.value)} (${fsActivity.read.peak.date}) |`,
      `| Firestore writes | ${formatNumberCompact(fsActivity.write.total)} | ${formatNumberCompact(fsActivity.write.avg)} | ${formatNumberCompact(fsActivity.write.peak.value)} (${fsActivity.write.peak.date}) |`,
      `| Firestore deletes | ${formatNumberCompact(fsActivity.delete.total)} | ${formatNumberCompact(fsActivity.delete.avg)} | ${formatNumberCompact(fsActivity.delete.peak.value)} (${fsActivity.delete.peak.date}) |`,
      `| Storage egress | ${formatBytes(storage.egressBytes30d)} | ${formatBytes(storage.egressBytes30d / 30)} | - |`,
      `| Storage Class A ops | ${formatNumberCompact(storage.requestCounts.classA)} | ${formatNumberCompact(Number(storage.requestCounts.classA || 0) / 30)} | - |`,
      `| Storage Class B ops | ${formatNumberCompact(storage.requestCounts.classB)} | ${formatNumberCompact(Number(storage.requestCounts.classB || 0) / 30)} | - |`,
      "",
      "### OpenAI 14d line items",
      "",
      "| model | input | output | total |",
      "| --- | ---: | ---: | ---: |",
    );

    if (openaiLineItems14d && openaiLineItems14d.length) {
      for (const item of openaiLineItems14d) {
        const inputUsd = item.entries
          .filter((entry) => entry.kind === "input")
          .reduce((sum, entry) => sum + entry.amountUsd, 0);
        const outputUsd = item.entries
          .filter((entry) => entry.kind === "output")
          .reduce((sum, entry) => sum + entry.amountUsd, 0);
        const totalJpy = Math.round(item.totalUsd * roughCost.usdToJpy);
        lines.push(
          `| ${item.model} | ${formatUsd(inputUsd, 3)} | ${formatUsd(outputUsd, 3)} | ${formatUsd(item.totalUsd, 3)} (${formatJpy(totalJpy, 0)}) |`,
        );
      }
    } else {
      lines.push("| - | - | - | - |");
    }

    lines.push(
      "",
      "### Firestore 14d details",
      "",
      "| date (UTC) | read | write | delete | total |",
      "| --- | ---: | ---: | ---: | ---: |",
    );

    for (const day of fs14Desc) {
      lines.push(
        `| ${day.date || "-"} | ${day.read || 0} | ${day.write || 0} | ${day.delete || 0} | ${day.total || 0} |`,
      );
    }

    return lines.join("\n");
  }

  return Object.freeze({
    CODEX_5H_LIMIT_TEMPORARILY_LIFTED,
    USAGE_REF_LINKS,
    getCodexLimitPolicy,
    getCodexWeeklyWindow,
    getUsageRefPageUrls,
    usageSourceFooterLines,
    moveUsageRefsToBodyStart,
    getCodexActivitySnapshot,
    usageOverviewBodyNeedsCurrentBuild,
    buildUsageOverviewBody,
  });
});
