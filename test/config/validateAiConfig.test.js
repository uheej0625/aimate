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
      chat: {
        provider: "vertex",
        model: "gemini-3-flash-preview",
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
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
      chat: {
        provider: "google",
        model: "gemini-3-flash-preview",
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
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
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
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
        prompt: "minimal",
      },
      image: { provider: "openai", model: "gpt-image-1", prompt: "minimal" },
    },
    secrets: {
      openaiApiKey: "",
    },
  });

  await assert.rejects(() => validateAiConfig(configManager), /OPENAI_API_KEY/);
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
    secrets: {
      openaiApiKey: "openai-key",
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
    secrets: { xaiApiKey: "", openaiApiKey: "openai-key" },
  });

  await assert.rejects(() => validateAiConfig(configManager), /XAI_API_KEY/);
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
    secrets: { aiGatewayApiKey: "gateway-key", openaiApiKey: "openai-key" },
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
    secrets: { xaiApiKey: "xai-key", openaiApiKey: "openai-key" },
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
    secrets: { openaiApiKey: "openai-key" },
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
    secrets: { aiGatewayApiKey: "gateway-key", openaiApiKey: "openai-key" },
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
    secrets: { openaiApiKey: "openai-key" },
  });

  await assert.rejects(
    () => validateAiConfig(configManager),
    /ai\.chat\.prompt.*ai\.image\.prompt/,
  );
});
