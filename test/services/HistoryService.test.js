import test from "node:test";
import assert from "node:assert";
import { HistoryService } from "../../src/services/HistoryService.js";

test("HistoryService tests", async (t) => {
  const mockMessageRepository = {
    getHistory: async () => [
      { id: "m1", authorPlatformId: "bot-1", authorId: "b1", content: "Hi" },
      {
        id: "m2",
        authorPlatformId: "user-1",
        authorId: "u1",
        content: "Hello",
      },
      {
        id: "m3",
        authorPlatformId: "user-1",
        authorId: "u1",
        content: "How are you?",
      },
    ],
  };

  const historyService = new HistoryService(mockMessageRepository);

  await t.test(
    "splitHistoryAndPending should split at last bot response",
    () => {
      const history = [
        { id: "m1", authorPlatformId: "bot-1", content: "Old bot" },
        { id: "m2", authorPlatformId: "user-1", content: "New user 1" },
        { id: "m3", authorPlatformId: "user-1", content: "New user 2" },
      ];
      const result = historyService.splitHistoryAndPending(history, "bot-1");
      assert.deepStrictEqual(
        result.historyMessages.map((m) => m.id),
        ["m1"],
      );
      assert.deepStrictEqual(
        result.pendingMessages.map((m) => m.id),
        ["m2", "m3"],
      );
    },
  );

  await t.test("fetchHistoryData should identify last user", async () => {
    const data = await historyService.fetchHistoryData("chan-1", "bot-1");
    assert.strictEqual(data.lastUserPlatformAccountId, "u1");
    assert.deepStrictEqual(data.messageIds, ["m2", "m3"]);
  });
});
