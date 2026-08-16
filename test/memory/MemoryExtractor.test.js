import test from "node:test";
import assert from "node:assert";
import { MemoryExtractor } from "../../src/memory/MemoryExtractor.js";

test("MemoryExtractor stores new facts from a completed generation", async () => {
  const created = [];
  const extractor = new MemoryExtractor(
    {
      findByUserId: async () => [],
      existsByContent: async () => false,
      create: async (data) => {
        created.push(data);
        return data;
      },
    },
    {
      findByPlatformAccountId: async () => ({ id: "user-1" }),
    },
    {
      findById: async () => ({ id: 42, authorId: "account-1" }),
    },
    {
      get: (key) => (key === "conversation.enableMemory" ? true : undefined),
    },
    {
      generateSummaryTextFn: async () => ({
        text: JSON.stringify({
          memories: [
            {
              content: "커피를 좋아한다",
              category: "preference",
              importance: 4,
            },
          ],
        }),
      }),
    },
  );

  await extractor.extractFromGeneration({
    generation: {
      id: 7,
      input: JSON.stringify({
        messages: [{ id: 42, content: "나 커피 좋아해" }],
      }),
    },
    aiResult: { messages: ["나도 커피 좋아해!"] },
  });

  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].userId, "user-1");
  assert.strictEqual(created[0].content, "커피를 좋아한다");
  assert.strictEqual(created[0].category, "preference");
  assert.strictEqual(created[0].importance, 4);
  assert.strictEqual(created[0].messageId, 42);
});

test("MemoryExtractor skips duplicate memories", async () => {
  const extractor = new MemoryExtractor(
    {
      findByUserId: async () => [{ content: "커피를 좋아한다" }],
      existsByContent: async (_userId, content) => content === "커피를 좋아한다",
      create: async () => {
        throw new Error("should not create duplicate");
      },
    },
    {
      findByPlatformAccountId: async () => ({ id: "user-1" }),
    },
    {
      findById: async () => ({ id: 42, authorId: "account-1" }),
    },
    {
      get: (key) => (key === "conversation.enableMemory" ? true : undefined),
    },
    {
      generateSummaryTextFn: async () => ({
        text: JSON.stringify({
          memories: [{ content: "커피를 좋아한다", category: "preference" }],
        }),
      }),
    },
  );

  await extractor.extractFromGeneration({
    generation: {
      id: 8,
      input: JSON.stringify({
        messages: [{ id: 42, content: "나 커피 좋아해" }],
      }),
    },
    aiResult: { messages: ["알고 있어"] },
  });
});
