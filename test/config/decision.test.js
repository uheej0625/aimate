import test from "node:test";
import assert from "node:assert/strict";
import { validateConversationConfig } from "../../src/chat/decision/config.js";

const manager = (value) => ({
  get: (key) => key.split(".").reduce((v, k) => v?.[k], value),
});
const config = () => ({
  conversation: { responseMode: "decision" },
  ai: {
    decision: {
      provider: "gateway",
      prompt: "default",
      model: "parallel/parallel-decisions-fast",
      timeoutMs: 10000,
    },
  },
});

test("Decision provider and prompt must be explicit supported settings", () => {
  for (const [key, value] of [
    ["provider", undefined],
    ["provider", "vertex"],
    ["prompt", undefined],
    ["prompt", ""],
    ["prompt", "../default"],
  ]) {
    const settings = config();
    settings.ai.decision[key] = value;
    assert.throws(
      () =>
        validateConversationConfig(manager(settings), {
          aiGatewayApiKey: "key",
        }),
      new RegExp(`ai.decision.${key}`),
    );
  }
});

test("buffer is the default and does not require decision model credentials", () => {
  assert.doesNotThrow(() => validateConversationConfig(manager({}), {}));
  assert.doesNotThrow(() =>
    validateConversationConfig(
      manager({ conversation: { responseMode: "buffer" } }),
      {},
    ),
  );
  assert.throws(
    () => validateConversationConfig(manager(config()), {}),
    /AI_GATEWAY_API_KEY.*buffer/,
  );
  assert.doesNotThrow(() =>
    validateConversationConfig(manager(config()), { aiGatewayApiKey: "key" }),
  );
});

test("invalid decision timing, budgets and modes fail configuration validation", () => {
  for (const changes of [
    { debounceMs: -1 },
    { debounceMs: 0.5 },
    { maxWaitMs: 500 },
    { recheckMs: -1 },
    { recheckMs: 0 },
    { recheckMultiplier: 1 },
    { recheckMultiplier: Infinity },
    { recheckMultiplier: "2" },
    { maxRecheckMs: 4999 },
    { maxRecheckMs: 0 },
    { maxRecheckMs: 2_147_483_648 },
    { maxContextMessages: 1.5 },
    { maxContextTokens: 100 },
    { rules: null },
  ]) {
    const value = config();
    value.conversation.decision = changes;
    assert.throws(() =>
      validateConversationConfig(manager(value), { aiGatewayApiKey: "key" }),
    );
  }
  const value = config();
  value.conversation.responseMode = "typo";
  assert.throws(
    () => validateConversationConfig(manager(value), {}),
    /responseMode/,
  );
});

test("zero debounce and configurable fractional backoff multipliers are valid", () => {
  const value = config();
  value.conversation.decision = {
    debounceMs: 0,
    recheckMultiplier: 1.5,
    maxRecheckMs: 10000,
  };
  assert.doesNotThrow(() =>
    validateConversationConfig(manager(value), { aiGatewayApiKey: "key" }),
  );
});
