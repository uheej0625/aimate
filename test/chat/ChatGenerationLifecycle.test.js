import test from "node:test";
import assert from "node:assert";
import { ChatGenerationLifecycle } from "../../src/chat/ChatGenerationLifecycle.js";

test("ChatGenerationLifecycle records chat input messages", async () => {
  let recordedInput = null;
  const lifecycle = new ChatGenerationLifecycle(
    {
      recordInputWithMessages: async (generationId, value) => {
        recordedInput = [generationId, value];
      },
    },
    {},
  );

  await lifecycle.recordInput(7, {
    messageIds: [1, 2],
    inputMessages: ["hello", "again"],
  });

  assert.deepStrictEqual(recordedInput, [
    7,
    {
      inputMessages: ["hello", "again"],
      messageIds: [1, 2],
    },
  ]);
});

test("ChatGenerationLifecycle keeps PROCESSING until output is recorded", async () => {
  const calls = [];
  const lifecycle = new ChatGenerationLifecycle(
    {
      findById: async () => ({ status: "PROCESSING" }),
      updateDetailsAndStatusIfCurrent: async (...args) => {
        calls.push(args);
        return true;
      },
    },
    {},
    {},
    {},
  );

  assert.strictEqual(await lifecycle.canGenerate(7), true);
  const result = await lifecycle.recordGeneratedOutput(7, {
    messages: ["hello"],
    apiRequests: ["request"],
    apiResponses: ["response"],
  });

  assert.deepStrictEqual(result, { shouldProceed: true });
  assert.deepStrictEqual(calls, [
    [
      7,
      "PROCESSING",
      "GENERATED",
      {
        output: '["hello"]',
        apiRequest: "request",
        apiResponse: "response",
      },
    ],
  ]);
});

test("ChatGenerationLifecycle does not overwrite cancelled generations", async () => {
  const transitions = [];
  const lifecycle = new ChatGenerationLifecycle(
    {
      updateStatusIfCurrent: async (...args) => {
        transitions.push(args);
        return false;
      },
    },
    {},
    {},
    {},
  );

  assert.strictEqual(await lifecycle.complete(7), false);
  assert.strictEqual(await lifecycle.cancel(7), false);
  assert.strictEqual(await lifecycle.fail(7), false);
  assert.deepStrictEqual(transitions, [
    [7, "GENERATED", "COMPLETED"],
    [7, ["PROCESSING", "GENERATED"], "CANCELLED"],
    [7, ["PROCESSING", "GENERATED"], "FAILED"],
  ]);
});
