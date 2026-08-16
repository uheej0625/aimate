import test from "node:test";
import assert from "node:assert";
import { MemoryService } from "../../src/memory/MemoryService.js";

test("MemoryService returns no memories when disabled", async () => {
  const service = new MemoryService(
    {
      findByUserId: async () => {
        throw new Error("should not query");
      },
    },
    {},
    {
      get: (key) => (key === "conversation.enableMemory" ? false : undefined),
    },
  );

  const memories = await service.loadForPlatformAccount("account-1");
  assert.deepStrictEqual(memories, []);
});

test("MemoryService formats memories for chat context", async () => {
  const service = new MemoryService(
    {
      findByUserId: async () => [
        { content: "피자를 좋아한다" },
        { content: "고양이를 키운다" },
      ],
    },
    {
      findByPlatformAccountId: async () => ({ id: "user-1" }),
    },
    {
      get: (key) => (key === "conversation.enableMemory" ? true : undefined),
    },
  );

  const memories = await service.loadForPlatformAccount("account-1");
  const formatted = service.formatForContext(memories);

  assert.match(formatted, /피자를 좋아한다/);
  assert.match(formatted, /고양이를 키운다/);
});
