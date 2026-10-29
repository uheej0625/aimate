import test from "node:test";
import assert from "node:assert";
import { validateAiConfig as validateConfig } from "../../src/config/index.js";

import { loadAiCredentials } from "../../src/ai/credentials.js";

const emptyCredentials = loadAiCredentials({});
const validCredentials = loadAiCredentials({
  OPENAI_API_KEY: "openai-key",
  GOOGLE_GENERATIVE_AI_API_KEY: "google-key",
  AI_GATEWAY_API_KEY: "gateway-key",
  XAI_API_KEY: "xai-key",
});
function validateAiConfig(manager, purposes, credentials = validCredentials) {
  return validateConfig(manager, purposes, credentials);
}

function createConfigManager(config) {
  return {
    get: (key) => key.split(".").reduce((obj, part) => obj?.[part], config),
  };
}

test("Vertex uses general project settings and ADC when no explicit credentials are supplied", async () => {
  const manager = createConfigManager({
    ai: {
      vertex: { projectId: "test-project", location: "global" },
      chat: { provider: "vertex", model: "test-model", prompt: "minimal" },
    },
  });
  assert.equal(
    await validateAiConfig(manager, ["chat"], emptyCredentials),
    true,
  );
  for (const env of [
    { VERTEX_CLIENT_EMAIL: "test@example.invalid" },
    { VERTEX_PRIVATE_KEY: "PRIVATE_SENTINEL" },
  ]) {
    await assert.rejects(
      () => validateAiConfig(manager, ["chat"], loadAiCredentials(env)),
      (error) => {
        assert.match(error.message, /VERTEX_CLIENT_EMAIL.*VERTEX_PRIVATE_KEY/);
        assert.doesNotMatch(
          error.message,
          /PRIVATE_SENTINEL|test@example.invalid/,
        );
        return true;
      },
    );
  }
  assert.equal(
    await validateAiConfig(
      manager,
      ["chat"],
      loadAiCredentials({
        VERTEX_CLIENT_EMAIL: "test@example.invalid",
        VERTEX_PRIVATE_KEY: "test-key",
      }),
    ),
    true,
  );
});

test("OpenAI-compatible rejects inline keys and requires environment credentials", async () => {
  const manager = createConfigManager({
    ai: {
      chat: {
        provider: "openaiCompatible",
        model: "test-model",
        prompt: "minimal",
        baseURL: "https://example.invalid/v1",
        apiKey: "PRIVATE_SENTINEL",
      },
    },
  });
  await assert.rejects(
    () => validateAiConfig(manager, ["chat"], emptyCredentials),
    (error) => {
      assert.match(error.message, /ai\.chat\.apiKey/);
      assert.match(error.message, /OPENAI_COMPATIBLE_API_KEY/);
      assert.doesNotMatch(error.message, /PRIVATE_SENTINEL/);
      return true;
    },
  );
});

test("validateAiConfig checks only active AI purposes", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "vertex",
        model: "gemini-3-flash-preview",
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
      summary: { provider: "google", model: "gemini-3-flash-preview" },
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager, undefined, emptyCredentials),
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
      chat: {
        provider: "google",
        model: "gemini-3-flash-preview",
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
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
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
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
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager, undefined, emptyCredentials),
    /OPENAI_API_KEY/,
  );
});

test("validateAiConfig rejects unknown providers", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "unknownProvider",
        model: "some-model",
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager),
    /ai\.chat\.provider="unknownProvider"/,
  );
});

test("validateAiConfig validates direct xAI credentials and API mode", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "xai",
        model: "grok-4.5",
        api: "responses",
        nativeTools: { webSearch: true },
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager, undefined, emptyCredentials),
    /XAI_API_KEY/,
  );
});

test("validateAiConfig accepts xAI native search through Gateway", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "gateway",
        model: "xai/grok-4.5",
        nativeTools: { webSearch: true },
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
    },
  });

  assert.strictEqual(await validateAiConfig(configManager), true);
});

test("validateAiConfig rejects direct xAI native tools without Responses", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "xai",
        model: "grok-4.5",
        api: "chat",
        nativeTools: { webSearch: true },
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager),
    (error) => {
      assert.match(error.message, /Responses API/);
      return true;
    },
  );
});

test("validateAiConfig requires a resolvable dialect for native tools", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "openai",
        model: "gpt-5-mini",
        nativeTools: { webSearch: true },
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager),
    /nativeTools에는 dialect가 필요합니다/,
  );
});

test("validateAiConfig rejects unknown native tool names", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: {
        provider: "gateway",
        model: "xai/grok-4.5",
        nativeTools: { websearch: true },
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager),
    /지원되지 않는 도구.*websearch.*허용값: webSearch/,
  );
});

test("validateAiConfig requires prompt packs for active purposes", async () => {
  const configManager = createConfigManager({
    ai: {
      chat: { provider: "openai", model: "gpt-5-mini" },
      image: { provider: "openai", model: "gpt-image-1" },
    },
  });

  await assert.rejects(
    () => validateAiConfig(configManager),
    /ai\.chat\.prompt.*ai\.image\.prompt/,
  );
});
