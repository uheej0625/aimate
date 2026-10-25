import test from "node:test";
import assert from "node:assert";
import { ChatGenerator } from "../../src/ai/ChatGenerator.js";
import { captureLogs } from "../helpers/logs.js";

test("ChatGenerator returns no messages or API requests for empty context", async () => {
  const generator = new ChatGenerator({
    configManager: {
      get: () => null,
    },
  });

  const result = await generator.generate([], "system");

  assert.deepStrictEqual(result.messages, []);
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

  assert.deepStrictEqual(contextInput, {
    platform: "discord",
    channel,
    abortSignal: abortController.signal,
  });
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

test("model logs summarize steps, usage and warnings without request or output bodies", async (t) => {
  const records = captureLogs(t);
  const generator = new ChatGenerator({
    configManager: {
      get: (key) =>
        key === "ai.chat"
          ? { provider: "openai", model: "test-model" }
          : undefined,
    },
    createLanguageModelFn: () => ({ modelId: "test-model" }),
    generateTextFn: async (request) => {
      const step = {
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        warnings: [{ message: "PRIVATE_WARNING" }],
        request: { body: "PRIVATE_REQUEST" },
        response: { body: "PRIVATE_RESPONSE" },
      };
      await request.onStepFinish(step);
      return {
        ...fakeTextResult("PRIVATE_OUTPUT"),
        usage: step.usage,
        totalUsage: step.usage,
        steps: [step],
      };
    },
  });
  await generator.generate(
    [{ role: "user", content: "PRIVATE_INPUT" }],
    "PRIVATE_SYSTEM",
  );
  const completed = records.find((row) => row.event === "model.completed");
  assert.strictEqual(completed.totalTokens, 15);
  assert.strictEqual(completed.finishReason, "stop");
  assert.ok(records.some((row) => row.event === "model.step.completed"));
  assert.ok(
    records.some(
      (row) => row.event === "model.warnings" && row.warningCount === 1,
    ),
  );
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_/);
});
