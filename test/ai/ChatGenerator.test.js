import test from "node:test";
import assert from "node:assert";
import { ChatGenerator } from "../../src/ai/ChatGenerator.js";

test("ChatGenerator returns an ellipsis for empty context", async () => {
  const generator = new ChatGenerator({
    configManager: {
      get: () => null,
    },
  });

  const result = await generator.generate([], "system");

  assert.deepStrictEqual(result.messages, ["..."]);
  assert.deepStrictEqual(result.apiRequests, []);
  assert.deepStrictEqual(result.apiResponses, []);
});

test("ChatGenerator creates tool context for the active channel", async () => {
  const channel = { id: "channel-1" };
  const toolContext = { channel };
  let contextInput = null;
  let registryInput = null;
  let capturedRequest = null;
  const abortController = new AbortController();
  const settings = {
    provider: "openai",
    model: "fake-model",
    prompt: "minimal",
  };
  const generator = new ChatGenerator({
    configManager: {
      get: (key) => {
        if (key === "ai.chat") return settings;
        if (key === "tools.maxSteps") return 5;
        return null;
      },
    },
    toolContextFactory: {
      create: (input) => {
        contextInput = input;
        return toolContext;
      },
    },
    toolRegistry: {
      createToolSet: (platform, context) => {
        registryInput = { platform, context };
        return {};
      },
    },
    generateTextFn: async (request) => {
      capturedRequest = request;
      return fakeTextResult("## messages\n안녕");
    },
    createLanguageModelFn: () => ({ modelId: "fake-model" }),
  });

  const result = await generator.generate(
    [{ role: "user", content: "안녕" }],
    "system",
    "discord",
    channel,
    { abortSignal: abortController.signal },
  );

  assert.deepStrictEqual(contextInput, { platform: "discord", channel });
  assert.deepStrictEqual(registryInput, {
    platform: "discord",
    context: toolContext,
  });
  assert.deepStrictEqual(result.messages, ["안녕"]);
  assert.strictEqual(capturedRequest.abortSignal, abortController.signal);
});

function fakeTextResult(text) {
  return {
    text,
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    warnings: [],
    request: {},
    response: {},
    providerMetadata: {},
    steps: [],
    toolResults: [],
  };
}
