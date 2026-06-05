import test from "node:test";
import assert from "node:assert";
import { ChatGenerationLifecycle } from "../../src/chat/ChatGenerationLifecycle.js";

test("ChatGenerationLifecycle records chat input messages", async () => {
  let details = null;
  const linkedMessageIds = [];
  const lifecycle = new ChatGenerationLifecycle(
    {
      updateDetails: async (_generationId, value) => {
        details = value;
      },
    },
    {},
    {
      addGenerationId: async (messageId, generationId) => {
        linkedMessageIds.push([messageId, generationId]);
      },
    },
    {},
  );

  await lifecycle.recordInput(7, {
    messageIds: [1, 2],
    inputMessages: ["hello", "again"],
  });

  assert.deepStrictEqual(JSON.parse(details.input), {
    messages: [
      { id: 1, content: "hello" },
      { id: 2, content: "again" },
    ],
  });
  assert.deepStrictEqual(linkedMessageIds, [
    [1, 7],
    [2, 7],
  ]);
});
