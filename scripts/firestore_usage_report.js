#!/usr/bin/env node

const { GoogleAuth } = require("google-auth-library");
const { parseArgs } = require("./codex_memo_core");

const METRIC_CANDIDATES = {
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
  read: 50000,
  write: 20000,
  delete: 20000
};

function usage() {
  console.log(`
Usage:
  npm run firestore:usage -- [--project "gcp-project-id"] [--hours "24"] [--json]

Options:
  --project  GCP project ID. 未指定時は認証情報から自動解決
  --hours    集計時間幅（デフォルト: 24）
  --json     JSONで出力

Required env:
  GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json
`);
}

function toNumberPoint(point) {
  const value = point && point.value ? point.value : {};
  if (value.int64Value !== undefined) return Number(value.int64Value);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.distributionValue !== undefined) return Number(value.distributionValue.count || 0);
  return 0;
}

function percentOf(value, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  return (value / total) * 100;
}

async function listMetricTotal({
  accessToken,
  projectId,
  metricType,
  startTime,
  endTime
}) {
  let pageToken = "";
  let total = 0;
  let points = 0;
  let seriesCount = 0;

  do {
    const qs = new URLSearchParams({
      filter: `metric.type="${metricType}"`,
      "interval.startTime": startTime,
      "interval.endTime": endTime,
      view: "FULL",
      "aggregation.alignmentPeriod": "3600s",
      "aggregation.perSeriesAligner": "ALIGN_SUM",
      "aggregation.crossSeriesReducer": "REDUCE_SUM"
    });
    if (pageToken) qs.set("pageToken", pageToken);

    const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${qs.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Monitoring API error (${res.status}) for ${metricType}: ${body}`);
    }

    const data = await res.json();
    const series = Array.isArray(data.timeSeries) ? data.timeSeries : [];
    seriesCount += series.length;
    for (const s of series) {
      const currentPoints = Array.isArray(s.points) ? s.points : [];
      points += currentPoints.length;
      for (const p of currentPoints) {
        total += toNumberPoint(p);
      }
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return {
    metricType,
    total,
    points,
    seriesCount
  };
}

async function findBestMetric({
  accessToken,
  projectId,
  startTime,
  endTime,
  candidates
}) {
  let lastResult = null;
  for (const metricType of candidates) {
    const result = await listMetricTotal({
      accessToken,
      projectId,
      metricType,
      startTime,
      endTime
    });
    lastResult = result;
    if (result.points > 0 || result.total > 0) {
      return result;
    }
  }
  return lastResult || {
    metricType: candidates[0],
    total: 0,
    points: 0,
    seriesCount: 0
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const hours = Number(args.hours || 24);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('Invalid --hours. Use a positive number, e.g. "24".');
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not set.");
  }

  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/monitoring.read"]
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;
  if (!accessToken) {
    throw new Error("Failed to get access token.");
  }

  const projectId = args.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || await auth.getProjectId();
  if (!projectId) {
    throw new Error("Project ID could not be resolved. Set --project.");
  }

  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const startTime = start.toISOString();
  const endTime = end.toISOString();

  const [read, write, del] = await Promise.all([
    findBestMetric({
      accessToken,
      projectId,
      startTime,
      endTime,
      candidates: METRIC_CANDIDATES.read
    }),
    findBestMetric({
      accessToken,
      projectId,
      startTime,
      endTime,
      candidates: METRIC_CANDIDATES.write
    }),
    findBestMetric({
      accessToken,
      projectId,
      startTime,
      endTime,
      candidates: METRIC_CANDIDATES.delete
    })
  ]);

  const output = {
    projectId,
    windowHours: hours,
    startTime,
    endTime,
    usage: {
      read: read.total,
      write: write.total,
      delete: del.total
    },
    limitsDaily: {
      ...DAILY_FREE_TIER_LIMITS
    },
    usageRatePercentOfDailyFreeTier: {
      read: percentOf(read.total, DAILY_FREE_TIER_LIMITS.read),
      write: percentOf(write.total, DAILY_FREE_TIER_LIMITS.write),
      delete: percentOf(del.total, DAILY_FREE_TIER_LIMITS.delete)
    },
    projectedDailyUsageFromWindow: {
      read: (read.total * 24) / hours,
      write: (write.total * 24) / hours,
      delete: (del.total * 24) / hours
    },
    projectedDailyRatePercentOfFreeTier: {
      read: percentOf((read.total * 24) / hours, DAILY_FREE_TIER_LIMITS.read),
      write: percentOf((write.total * 24) / hours, DAILY_FREE_TIER_LIMITS.write),
      delete: percentOf((del.total * 24) / hours, DAILY_FREE_TIER_LIMITS.delete)
    },
    metricTypes: {
      read: read.metricType,
      write: write.metricType,
      delete: del.metricType
    },
    note: "Cloud Monitoring sampled metrics are typically delayed by up to a few minutes."
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Project: ${output.projectId}`);
  console.log(`Window:  ${output.startTime} .. ${output.endTime} (${hours}h)`);
  console.log("");
  console.log(
    `read:   ${output.usage.read} / ${output.limitsDaily.read} (${output.usageRatePercentOfDailyFreeTier.read.toFixed(3)}%)  (${output.metricTypes.read})`
  );
  console.log(
    `write:  ${output.usage.write} / ${output.limitsDaily.write} (${output.usageRatePercentOfDailyFreeTier.write.toFixed(3)}%)  (${output.metricTypes.write})`
  );
  console.log(
    `delete: ${output.usage.delete} / ${output.limitsDaily.delete} (${output.usageRatePercentOfDailyFreeTier.delete.toFixed(3)}%)  (${output.metricTypes.delete})`
  );
  if (hours !== 24) {
    console.log("");
    console.log(
      `Projected daily usage from ${hours}h window -> read:${output.projectedDailyUsageFromWindow.read.toFixed(
        2
      )}, write:${output.projectedDailyUsageFromWindow.write.toFixed(
        2
      )}, delete:${output.projectedDailyUsageFromWindow.delete.toFixed(2)}`
    );
    console.log(
      `Projected daily rate -> read:${output.projectedDailyRatePercentOfFreeTier.read.toFixed(
        3
      )}%, write:${output.projectedDailyRatePercentOfFreeTier.write.toFixed(
        3
      )}%, delete:${output.projectedDailyRatePercentOfFreeTier.delete.toFixed(3)}%`
    );
  }
  console.log("");
  console.log(output.note);
}

main().catch((err) => {
  console.error("Failed to fetch Firestore usage:", err.message);
  process.exit(1);
});
