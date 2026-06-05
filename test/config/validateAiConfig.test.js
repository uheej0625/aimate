import test from "node:test";
import assert from "node:assert";
import { validateAiConfig } from "../../src/config/index.js";

function createConfigManager(config) {
  return {
    get: (key) => key.split(".").reduce((obj, part) => obj?.[part], config),
  };
}

test("validateAiConfig checks only active AI purposes", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: { provider: "vertex", model: "gemini-3-flash-preview" },
      image: { provider: "openai", model: "gpt-image-1" },
      summary: { provider: "google", model: "gemini-3-flash-preview" },
    },
    secrets: {
      vertexProjectId: "",
      vertexLocation: "global",
      vertexClientEmail: "",
      vertexPrivateKey: "",
      openaiApiKey: "",
      googleApiKey: "",
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager),
    (error) => {
      assert.match(error.message, /VERTEX_PROJECT_ID/);
      assert.match(error.message, /OPENAI_API_KEY/);
      assert.doesNotMatch(error.message, /GOOGLE_GENERATIVE_AI_API_KEY/);
      return true;
    },
  );
});

test("validateAiConfig accepts valid active provider config", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: { provider: "google", model: "gemini-3-flash-preview" },
      image: { provider: "openai", model: "gpt-image-1" },
    },
    secrets: {
      googleApiKey: "google-key",
      openaiApiKey: "openai-key",
    },
  });

  assert.strictEqual(await validateAiConfig(configManager), true);
});

test("validateAiConfig accepts gateway provider config", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "gateway",
        model: "openai/gpt-5-mini",
      },
      image: { provider: "openai", model: "gpt-image-1" },
    },
    secrets: {
      aiGatewayApiKey: "gateway-key",
      openaiApiKey: "openai-key",
    },
  });

  assert.strictEqual(await validateAiConfig(configManager), true);
});

test("validateAiConfig validates provider credentials", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "openai",
        model: "gpt-5-mini",
      },
      image: { provider: "openai", model: "gpt-image-1" },
    },
    secrets: {
      openaiApiKey: "",
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager),
    /OPENAI_API_KEY/,
  );
});

test("validateAiConfig rejects unknown providers", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: { provider: "unknownProvider", model: "some-model" },
      image: { provider: "openai", model: "gpt-image-1" },
    },
    secrets: {
      openaiApiKey: "openai-key",
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager),
    /ai\.chat\.provider="unknownProvider"/,
  );
});
