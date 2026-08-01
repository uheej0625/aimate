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
  });

  assert.deepStrictEqual(Object.keys(capturedRequest.tools), [
    "get_current_time",
    "web_search",
  ]);
  assert.strictEqual(capturedRequest.tools.web_search.id, "xai.web_search");
});
