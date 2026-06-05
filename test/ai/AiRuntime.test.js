import test from "node:test";
import assert from "node:assert";
import { AiRuntime } from "../../src/ai/AiRuntime.js";

test("AiRuntime keeps parsing helpers and context preparation focused", async () => {
  const runtime = new AiRuntime({
    historyService: {},
    configManager: { get: () => null },
    chatContextPreparer: {
      prepare: async () => ({
        context: ["assembled-context"],
        systemInstruction: "system",
        messageIds: ["msg-1"],
        inputMessages: ["hello"],
        currentUserId: "user-1",
      }),
    },
  });

  const prepared = await runtime.prepareContext("channel-1", "bot-1");
  assert.deepStrictEqual(prepared.context, ["assembled-context"]);
  assert.strictEqual(prepared.currentUserId, "user-1");

  const parsed = runtime._parseAIResponse(`
## messages
Hello [BREAK] Again
## emotion_delta
happiness: 5
## relationship_delta
trust: 2
`);

  assert.deepStrictEqual(parsed.messages, ["Hello", "Again"]);
  assert.deepStrictEqual(parsed.emotionDelta, { happiness: 5 });
  assert.deepStrictEqual(parsed.relationshipDelta, { trust: 2 });
});

test("AiRuntime returns an ellipsis for empty chat context without model calls", async () => {
  const runtime = new AiRuntime({
    historyService: {},
    configManager: { get: () => null },
  });

  const result = await runtime.generateChat([], "system");
  assert.deepStrictEqual(result.messages, ["..."]);
  assert.deepStrictEqual(result.apiRequests, []);
  assert.deepStrictEqual(result.apiResponses, []);
});
