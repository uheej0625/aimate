import test from "node:test";
import assert from "node:assert";
import { ConversationBuffer } from "../../src/core/ConversationBuffer.js";

test("ConversationBuffer tests", async (t) => {
  const mockConfigManager = {
    get: () => 10, // 10ms timeout for testing
  };

  await t.test("add should trigger chatFlow after timeout", async () => {
    let executed = false;
    const mockChatFlow = {
      execute: async () => {
        executed = true;
      },
    };

    const buffer = new ConversationBuffer(mockChatFlow, mockConfigManager);
    buffer.add("chan-1", { id: "chan-1" }, "bot-1");

    assert.strictEqual(executed, false, "Should not execute immediately");

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(executed, true, "Should execute after timeout");
  });

  await t.test("add should debounce subsequent calls", async () => {
    let callCount = 0;
    const mockChatFlow = {
      execute: async () => {
        callCount++;
      },
    };

    const buffer = new ConversationBuffer(mockChatFlow, mockConfigManager);
    buffer.add("chan-2", { id: "chan-2" }, "bot-1");
    
    await new Promise((resolve) => setTimeout(resolve, 5));
    buffer.add("chan-2", { id: "chan-2" }, "bot-1"); // reset timer

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(callCount, 1, "Should only execute once if debounced");
  });

  await t.test("clear should prevent execution", async () => {
    let executed = false;
    const mockChatFlow = {
      execute: async () => {
        executed = true;
      },
    };

    const buffer = new ConversationBuffer(mockChatFlow, mockConfigManager);
    buffer.add("chan-3", { id: "chan-3" }, "bot-1");
    buffer.clear("chan-3");

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(executed, false, "Should not execute if cleared");
  });
});
