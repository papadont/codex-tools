(function initUsageOverviewShared(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.UsageOverviewShared = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function usageOverviewSharedFactory() {
  "use strict";

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
    const codexSecondary = codexSummary?.secondaryWindow || null;
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
      codexSummary
        ? `- 5h remaining: ${boldPercent(codexPrimary?.remainingPercent, 0)} reset: ${formatDate(codexPrimary?.resetAtISO)}`
        : `- status: ${codexError ? `error (${codexError})` : "loading"}`,
      codexSummary
        ? `- weekly remaining: ${boldPercent(codexSecondary?.remainingPercent, 0)} reset: ${formatDate(codexSecondary?.resetAtISO)}`
        : "- weekly remaining: -",
      codexSummary
        ? `- next resetまで: ${formatDuration(codexSummary?.secondaryWindow?.resetAfterSeconds || 0)} / used ${boldPercent(codexSecondary?.usedPercent, 0)}`
        : "- next resetまで: -",
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

    lines.push(...usageSourceFooterLines({ interactive: interactiveRefs }));
    return lines.join("\n");
  }

  return Object.freeze({
    USAGE_REF_LINKS,
    getUsageRefPageUrls,
    usageSourceFooterLines,
    buildUsageOverviewBody,
  });
});
