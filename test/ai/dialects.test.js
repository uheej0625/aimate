import test from "node:test";
import assert from "node:assert";
import { composeDialectTools, resolveDialect } from "../../src/ai/dialects.js";

test("resolveDialect infers xAI from a Gateway model ID", () => {
  assert.strictEqual(
    resolveDialect({ provider: "gateway", model: "xai/grok-4.5" }),
    "xai",
  );
});

test("resolveDialect infers xAI from the direct provider and preserves overrides", () => {
  assert.strictEqual(
    resolveDialect({ provider: "xai", model: "grok-4.5" }),
    "xai",
  );
  assert.strictEqual(
    resolveDialect({
      provider: "gateway",
      model: "xai/grok-4.5",
      dialect: "custom",
    }),
    "custom",
  );
});

test("composeDialectTools leaves application tools unchanged without a dialect", () => {
  const appTools = { get_time: { execute: async () => ({}) } };

  assert.strictEqual(composeDialectTools({ settings: {}, appTools }), appTools);
});

test("composeDialectTools creates xAI web search as a provider tool", () => {
  const tools = composeDialectTools({
    settings: {
      provider: "gateway",
      model: "xai/grok-4.5",
      nativeTools: {
        webSearch: { allowedDomains: ["example.com"] },
      },
    },
  });

  assert.deepStrictEqual(Object.keys(tools), ["web_search"]);
  assert.strictEqual(tools.web_search.type, "provider");
  assert.strictEqual(tools.web_search.id, "xai.web_search");
  assert.deepStrictEqual(tools.web_search.args, {
    allowedDomains: ["example.com"],
  });
});

test("composeDialectTools rejects native tools without a dialect", () => {
  assert.throws(
    () =>
      composeDialectTools({
        settings: { nativeTools: { webSearch: true } },
      }),
    /require an AI dialect/,
  );
});

test("composeDialectTools rejects an unknown dialect", () => {
  assert.throws(
    () => composeDialectTools({ settings: { dialect: "unknown" } }),
    /Unsupported AI dialect/,
  );
});

test("composeDialectTools combines xAI native and application tools", () => {
  const getTime = { execute: async () => ({}) };
  const tools = composeDialectTools({
    settings: {
      provider: "gateway",
      model: "xai/grok-4.5",
      nativeTools: { webSearch: true },
    },
    appTools: { get_time: getTime },
  });

  assert.deepStrictEqual(Object.keys(tools), ["get_time", "web_search"]);
  assert.strictEqual(tools.get_time, getTime);
  assert.strictEqual(tools.web_search.id, "xai.web_search");
});

test("composeDialectTools preserves application tools for direct xAI Responses", () => {
  const appTools = { get_time: { execute: async () => ({}) } };

  assert.strictEqual(
    composeDialectTools({
      settings: {
        provider: "xai",
        api: "responses",
      },
      appTools,
    }).get_time,
    appTools.get_time,
  );
});

test("composeDialectTools rejects unknown native tool names", () => {
  assert.throws(
    () =>
      composeDialectTools({
        settings: {
          provider: "gateway",
          model: "xai/grok-4.5",
          nativeTools: { websearch: true },
        },
      }),
    /지원되지 않는 도구.*websearch.*허용값: webSearch/,
  );
});

test("composeDialectTools rejects duplicate native tool names", () => {
  assert.throws(
    () =>
      composeDialectTools({
        settings: {
          provider: "gateway",
          model: "xai/grok-4.5",
          nativeTools: { webSearch: true },
        },
        appTools: { web_search: { execute: async () => ({}) } },
      }),
    /Duplicate AI tools: web_search/,
  );
});
