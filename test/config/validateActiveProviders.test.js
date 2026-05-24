import test from "node:test";
import assert from "node:assert";
import { validateActiveProviders } from "../../src/config/index.js";

function createConfigManager(config) {
  return {
    get: (key) => key.split(".").reduce((obj, part) => obj?.[part], config),
  };
}

test("validateActiveProviders checks only instantiated AI purposes", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: { provider: "vertex", model: "gemini-3-flash-preview" },
      image: { provider: "openai", model: "gpt-image-2-2026-04-21" },
      summary: { provider: "googleCloud", model: "gemini-3-flash-preview" },
    },
    secrets: {
      vertexProjectId: "",
      vertexLocation: "global",
      vertexClientEmail: "",
      vertexPrivateKey: "",
      openaiApiKey: "",
      googleCloudApiKey: "",
    },
  });

  await assert.rejects(
    () => validateActiveProviders(configManager),
    (error) => {
      assert.match(error.message, /VERTEX_PROJECT_ID/);
      assert.match(error.message, /VERTEX_CLIENT_EMAIL/);
      assert.match(error.message, /VERTEX_PRIVATE_KEY/);
      assert.match(error.message, /OPENAI_API_KEY/);
      assert.doesNotMatch(error.message, /GOOGLE_CLOUD_API_KEY/);
      return true;
    },
  );
});

test("validateActiveProviders accepts valid active provider config", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: { provider: "googleCloud", model: "gemini-3-flash-preview" },
      image: { provider: "openai", model: "gpt-image-2-2026-04-21" },
    },
    secrets: {
      googleCloudApiKey: "google-key",
      openaiApiKey: "openai-key",
    },
  });

  assert.strictEqual(await validateActiveProviders(configManager), true);
});

test("validateActiveProviders accepts AI SDK gateway provider config", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "aiSdk",
        model: "openai/gpt-5-mini",
        aiSdk: { provider: "gateway" },
      },
      image: { provider: "openai", model: "gpt-image-2-2026-04-21" },
    },
    secrets: {
      aiGatewayApiKey: "gateway-key",
      openaiApiKey: "openai-key",
    },
  });

  assert.strictEqual(await validateActiveProviders(configManager), true);
});

test("validateActiveProviders validates AI SDK subprovider credentials", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "aiSdk",
        model: "gpt-5-mini",
        aiSdk: { provider: "openai" },
      },
      image: { provider: "openai", model: "gpt-image-2-2026-04-21" },
    },
    secrets: {
      openaiApiKey: "",
    },
  });

  await assert.rejects(
    () => validateActiveProviders(configManager),
    /OPENAI_API_KEY/,
  );
});

test("validateActiveProviders rejects unknown providers", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: { provider: "unknownProvider", model: "some-model" },
      image: { provider: "openai", model: "gpt-image-2-2026-04-21" },
    },
    secrets: {
      openaiApiKey: "openai-key",
    },
  });

  await assert.rejects(
    () => validateActiveProviders(configManager),
    /ai\.chat\.provider="unknownProvider"/,
  );
});
