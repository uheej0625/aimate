import test from "node:test";
import assert from "node:assert";
import { AiRuntime } from "../../src/ai/AiRuntime.js";

test("AiRuntime keeps parsing helpers and context preparation focused", async () => {
  const runtime = new AiRuntime({
    historyService: {},
    configManager: {
      get: (key) => (key === "character" ? "test" : null),
    },
    chatContextPreparer: {
      prepare: async () => ({
        context: ["assembled-context"],
        systemInstruction: "system",
        messageIds: ["msg-1"],
        inputMessages: ["hello"],
      }),
    },
  });

  const prepared = await runtime.prepareContext("channel-1", "bot-1");
  assert.deepStrictEqual(prepared.context, ["assembled-context"]);

  const parsed = runtime._parseAIResponse(`
## messages
Hello [BREAK] Again
`);

  assert.deepStrictEqual(parsed.messages, ["Hello", "Again"]);
});

test("AiRuntime returns an ellipsis for empty chat context without model calls", async () => {
  const runtime = new AiRuntime({
    historyService: {},
    configManager: {
      get: (key) => (key === "character" ? "test" : null),
    },
  });

  const result = await runtime.generateChat([], "system");
  assert.deepStrictEqual(result.messages, ["..."]);
  assert.deepStrictEqual(result.apiRequests, []);
  assert.deepStrictEqual(result.apiResponses, []);
});
