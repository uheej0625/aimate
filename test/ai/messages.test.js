import test from "node:test";
import assert from "node:assert";
import { generateChatReply, toModelMessages } from "../../src/ai/chat.js";

test("toModelMessages converts app chat context to AI SDK model messages", () => {
  assert.deepStrictEqual(
    toModelMessages([
      { role: "user", content: "몇 시야?" },
      { role: "assistant", content: "잠깐만" },
      { role: "tool_result", content: "legacy value" },
    ]),
    [
      { role: "user", content: "몇 시야?" },
      { role: "assistant", content: "잠깐만" },
      { role: "user", content: "legacy value" },
    ],
  );
});

test("generateChatReply sends xAI native and application tools together", async () => {
  let capturedRequest;
  const abortController = new AbortController();
  const settings = {
    provider: "gateway",
    model: "xai/grok-4.5",
    nativeTools: { webSearch: true },
  };
  const configManager = {
    get(key) {
      if (key === "ai.chat") return settings;
      if (key === "tools.maxSteps") return 5;
      return undefined;
    },
  };

  await generateChatReply({
    configManager,
    context: [{ role: "user", content: "최신 소식을 알려줘" }],
    platform: "cli",
    toolRegistry: {
      createToolSet: () => ({
        get_current_time: { execute: async () => ({}) },
      }),
    },
    responseParser: { parse: (text) => ({ messages: [text] }) },
    generateTextFn: async (request) => {
      capturedRequest = request;
      return { text: "완료", finishReason: "stop", steps: [] };
    },
    createLanguageModelFn: () => ({ provider: "test" }),
    abortSignal: abortController.signal,
  });

  assert.deepStrictEqual(Object.keys(capturedRequest.tools), [
    "get_current_time",
    "web_search",
  ]);
  assert.strictEqual(capturedRequest.tools.web_search.id, "xai.web_search");
  assert.strictEqual(capturedRequest.abortSignal, abortController.signal);
});

test("generateChatReply executes JSON-only pseudo tool calls without another model request", async () => {
  const requests = [];
  const executions = [];
  const settings = {
    provider: "gateway",
    model: "xai/grok-4.5",
  };
  const configManager = {
    get(key) {
      if (key === "ai.chat") return settings;
      if (key === "tools.maxSteps") return 5;
      return undefined;
    },
  };
  const pseudoCall = {
    text: [
      "```json",
      JSON.stringify({
        name: "register_cron_job",
        arguments: { scheduledTime: "2m", message: "알림 메시지" },
      }),
      "```",
    ].join("\n"),
    finishReason: "stop",
    steps: [{ stepNumber: 0, toolCalls: [], toolResults: [] }],
  };
  const result = await generateChatReply({
    configManager,
    context: [{ role: "user", content: "2분 후에 알려줘" }],
    platform: "discord",
    toolRegistry: {
      createToolSet: () => ({
        register_cron_job: {
          execute: async (input, options) => {
            executions.push({ input, options });
            return { success: true, message: "예약했어" };
          },
        },
      }),
    },
    responseParser: { parse: (text) => ({ messages: [text] }) },
    generateTextFn: async (request) => {
      requests.push(request);
      return pseudoCall;
    },
    createLanguageModelFn: () => ({ provider: "test" }),
  });

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(executions.length, 1);
  assert.deepStrictEqual(executions[0].input, {
    scheduledTime: "2m",
    message: "알림 메시지",
  });
  assert.deepStrictEqual(executions[0].options.messages, [
    { role: "user", content: "2분 후에 알려줘" },
  ]);
  assert.deepStrictEqual(result.messages, ["예약했어"]);
  assert.strictEqual(result.apiRequests.length, 1);
  assert.strictEqual(result.apiResponses.length, 1);
  assert.deepStrictEqual(
    result.apiResponses[0].recoveredTextToolCall.input,
    executions[0].input,
  );
});

test("generateChatReply does not retry ordinary JSON or completed tool calls", async () => {
  const responses = [
    {
      text: '```json\n{"status":"ok"}\n```',
      finishReason: "stop",
      steps: [],
    },
    {
      text: '{"name":"echo","arguments":{}}',
      finishReason: "stop",
      steps: [{ toolCalls: [{ toolName: "echo" }], toolResults: [] }],
    },
  ];

  for (const response of responses) {
    let callCount = 0;
    await generateChatReply({
      configManager: {
        get(key) {
          if (key === "ai.chat") {
            return { provider: "openai", model: "fake-model" };
          }
          if (key === "tools.maxSteps") return 5;
          return undefined;
        },
      },
      context: [{ role: "user", content: "테스트" }],
      platform: "cli",
      toolRegistry: {
        createToolSet: () => ({ echo: { execute: async () => ({}) } }),
      },
      responseParser: { parse: (text) => ({ messages: [text] }) },
      generateTextFn: async () => {
        callCount += 1;
        return response;
      },
      createLanguageModelFn: () => ({ provider: "test" }),
    });

    assert.strictEqual(callCount, 1);
  }
});
