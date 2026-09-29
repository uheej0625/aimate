import test from "node:test";
import assert from "node:assert";
import { ChatContextPreparer } from "../../../src/chat/context/ChatContextPreparer.js";

test("ChatContextPreparer loads history and sequence", async () => {
  let sequenceBuildInput = null;
  let startedAt;
  const historyService = {
    fetchHistoryData: async () => {
      startedAt = new Date();
      return {
        historyMessages: [{ role: "assistant", content: "old" }],
        pendingMessages: [{ id: "msg-1", content: "new" }],
        messageIds: ["msg-1"],
        inputMessages: ["new"],
      };
    },
  };
  const configManager = {
    get: (key) => (key === "ai.chat.prompt" ? "minimal" : null),
  };
  const sequenceBuilder = {
    loadSequence: async (promptName) => [`sequence:${promptName}`],
    build: async (sequenceDef, input) => {
      sequenceBuildInput = { sequenceDef, input };
      return {
        context: ["built-context"],
        systemInstruction: "system",
      };
    },
  };
  const preparer = new ChatContextPreparer(
    historyService,
    configManager,
    sequenceBuilder,
    {
      loadForPlatformAccount: () => assert.fail("Memory must not be queried"),
      formatForContext: () => assert.fail("Memory must not be injected"),
    },
  );

  const result = await preparer.prepare(
    "channel-1",
    "bot-1",
    { id: "channel-1" },
  );

  assert.deepStrictEqual(result.context, ["built-context"]);
  assert.strictEqual(result.systemInstruction, "system");
  assert.deepStrictEqual(result.messageIds, ["msg-1"]);
  assert.deepStrictEqual(result.inputMessages, ["new"]);
  assert.deepStrictEqual(sequenceBuildInput.sequenceDef, ["sequence:minimal"]);
  assert.strictEqual(sequenceBuildInput.input.promptName, "minimal");
  assert.ok(sequenceBuildInput.input.referenceDate instanceof Date);
  assert.ok(sequenceBuildInput.input.referenceDate <= startedAt);
  assert.equal(sequenceBuildInput.input.data, undefined);
});
