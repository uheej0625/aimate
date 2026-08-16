import test from "node:test";
import assert from "node:assert";
import { createLanguageModel } from "../../src/ai/models.js";

function createConfig(settings) {
  return {
    get: (key) =>
      ({
        "ai.chat": settings,
        "secrets.xaiApiKey": "xai-test-key",
      })[key],
  };
}

test("direct xAI Responses configuration creates a Responses model", () => {
  const model = createLanguageModel(
    createConfig({
      provider: "xai",
      model: "grok-4.5",
      api: "responses",
    }),
  );

  assert.strictEqual(model.provider, "xai.responses");
});

test("direct xAI defaults to the chat model API", () => {
  const model = createLanguageModel(
    createConfig({ provider: "xai", model: "grok-4.5" }),
  );

  assert.strictEqual(model.provider, "xai.chat");
});
