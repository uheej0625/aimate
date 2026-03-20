import test from "node:test";
import assert from "node:assert";
import { ContextService } from "../../src/services/ContextService.js";

test("ContextService tests", async (t) => {
  const mockMessageRepository = {
    getHistory: async () => [
      { id: "m1", authorPlatformId: "bot-1", authorId: "b1", content: "Hi" },
      { id: "m2", authorPlatformId: "user-1", authorId: "u1", content: "Hello" },
      { id: "m3", authorPlatformId: "user-1", authorId: "u1", content: "How are you?" },
    ],
  };

  const contextService = new ContextService(mockMessageRepository);

  await t.test("extractPendingMessageIds should return messages since last bot response", () => {
    const history = [
      { id: "m1", authorPlatformId: "bot-1", content: "Old bot" },
      { id: "m2", authorPlatformId: "user-1", content: "New user 1" },
      { id: "m3", authorPlatformId: "user-1", content: "New user 2" },
    ];
    const ids = contextService.extractPendingMessageIds(history, "bot-1");
    assert.deepStrictEqual(ids, ["m2", "m3"]);
  });

  await t.test("assembleContext should format history for AI", () => {
    const history = [
      { id: "m1", authorPlatformId: "bot-1", content: "Bot msg" },
      { id: "m2", authorPlatformId: "user-1", content: "User msg" },
    ];
    const context = contextService.assembleContext(history, "bot-1", "Cron!");
    
    assert.strictEqual(context.length, 3);
    assert.strictEqual(context[0].role, "assistant");
    assert.strictEqual(context[1].role, "user");
    assert.strictEqual(context[2].role, "user");
    assert.ok(context[2].content.includes("Cron!"));
  });

  await t.test("fetchHistoryData should identify last user", async () => {
    const data = await contextService.fetchHistoryData("chan-1", "bot-1");
    assert.strictEqual(data.lastUserPlatformAccountId, "u1");
    assert.deepStrictEqual(data.messageIds, ["m2", "m3"]);
  });
});
