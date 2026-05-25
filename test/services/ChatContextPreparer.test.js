import test from "node:test";
import assert from "node:assert";
import { ChatContextPreparer } from "../../src/services/ChatContextPreparer.js";

test("ChatContextPreparer loads history, current user, and sequence", async () => {
  let sequenceBuildInput = null;
  const historyService = {
    fetchHistoryData: async () => ({
      historyMessages: [{ role: "assistant", content: "old" }],
      pendingMessages: [{ id: "msg-1", content: "new" }],
      messageIds: ["msg-1"],
      inputMessages: ["new"],
      lastUserPlatformAccountId: "account-1",
    }),
  };
  const configManager = {
    get: (key) => (key === "ai.chat.prompt" ? "default" : null),
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
  const userRepository = {
    findByPlatformAccountId: async () => ({ id: "user-1", trust: 40 }),
  };

  const preparer = new ChatContextPreparer(
    historyService,
    configManager,
    sequenceBuilder,
    userRepository,
  );

  const result = await preparer.prepare(
    "channel-1",
    "bot-1",
    { id: "channel-1" },
    "cron",
  );

  assert.deepStrictEqual(result.context, ["built-context"]);
  assert.strictEqual(result.systemInstruction, "system");
  assert.deepStrictEqual(result.messageIds, ["msg-1"]);
  assert.deepStrictEqual(result.inputMessages, ["new"]);
  assert.strictEqual(result.currentUserId, "user-1");
  assert.deepStrictEqual(sequenceBuildInput.sequenceDef, ["sequence:default"]);
  assert.strictEqual(sequenceBuildInput.input.userRecord.id, "user-1");
});
