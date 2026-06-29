const test = require("node:test");
const assert = require("node:assert/strict");

const serverSummary = require("../scripts/codex_memo_web_server");
const batchSummary = require("../scripts/usage_memo_fire_from_latest");

const modules = [
  ["server", serverSummary],
  ["batch", batchSummary],
];

function withSummaryEnv(env, fn) {
  const keys = [
    "USAGE_OVERVIEW_SUMMARY_MODEL",
    "USAGE_OVERVIEW_SUMMARY_MODELS",
    "USAGE_OVERVIEW_SUMMARY_PROVIDER",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, env);
  try {
    fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

for (const [name, mod] of modules) {
  test(`${name} infers mixed usage overview summary model chains`, () => {
    withSummaryEnv(
      {
        USAGE_OVERVIEW_SUMMARY_MODELS:
          "gpt-4.1-nano gemini-2.5-flash openai:o4-mini gemini:models/gemini-2.0-flash",
      },
      () => {
        assert.deepEqual(mod.getUsageOverviewSummaryModels(), [
          "openai:gpt-4.1-nano",
          "gemini:gemini-2.5-flash",
          "openai:o4-mini",
          "gemini:models/gemini-2.0-flash",
        ]);
        assert.equal(
          mod.getUsageOverviewSummaryModelChainLabel(),
          "openai:gpt-4.1-nano -> gemini:gemini-2.5-flash -> openai:o4-mini -> gemini:models/gemini-2.0-flash",
        );
      },
    );
  });

  test(`${name} applies provider fallback to unprefixed legacy model`, () => {
    withSummaryEnv(
      {
        USAGE_OVERVIEW_SUMMARY_PROVIDER: "gemini",
        USAGE_OVERVIEW_SUMMARY_MODEL: "custom-fast",
      },
      () => {
        assert.deepEqual(mod.getUsageOverviewSummaryModels(), [
          "gemini:custom-fast",
        ]);
      },
    );
  });

  test(`${name} labels provider-aware local fallback attempts`, () => {
    assert.equal(
      mod.buildUsageOverviewAiErrorModelLabel([
        "openai:gpt-4.1-nano",
        "gemini:gemini-2.5-flash",
      ]),
      "local-template(ai-error after openai:gpt-4.1-nano -> gemini:gemini-2.5-flash)",
    );
  });
}
