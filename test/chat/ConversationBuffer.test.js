import test from "node:test";
import assert from "node:assert";
import { ConversationBuffer } from "../../src/chat/ConversationBuffer.js";

test("ConversationBuffer tests", async (t) => {
  const mockConfigManager = {
    get: () => 10, // 10ms timeout for testing
  };

  await t.test("add should trigger chatFlow after timeout", async () => {
    let executedRequest = null;
    const mockChatFlow = {
      execute: async (request) => {
        executedRequest = request;
      },
    };

    const buffer = new ConversationBuffer(mockChatFlow, mockConfigManager);
    const request = createRequest("cli", "chan-1", "bot-1");
    buffer.add(request);

    assert.strictEqual(executedRequest, null, "Should not execute immediately");

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(executedRequest, request);
  });

  await t.test("add should debounce subsequent calls", async () => {
    let callCount = 0;
    const mockChatFlow = {
      execute: async () => {
        callCount++;
      },
    };

    const buffer = new ConversationBuffer(mockChatFlow, mockConfigManager);
    buffer.add(createRequest("cli", "chan-2", "bot-1"));
    
    await new Promise((resolve) => setTimeout(resolve, 5));
    buffer.add(createRequest("cli", "chan-2", "bot-1")); // reset timer

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(callCount, 1, "Should only execute once if debounced");
  });

  await t.test("add should keep same channel IDs on different platforms separate", async () => {
    let callCount = 0;
    const mockChatFlow = {
      execute: async () => {
        callCount++;
      },
    };

    const buffer = new ConversationBuffer(mockChatFlow, mockConfigManager);
    buffer.add(createRequest("discord", "same-id", "discord-bot"));
    buffer.add(createRequest("cli", "same-id", "cli-bot"));

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(callCount, 2);
  });

  await t.test("clear should prevent execution", async () => {
    let executed = false;
    const mockChatFlow = {
      execute: async () => {
        executed = true;
      },
    };

    const buffer = new ConversationBuffer(mockChatFlow, mockConfigManager);
    const request = createRequest("cli", "chan-3", "bot-1");
    buffer.add(request);
    buffer.clear(request.channel);

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.strictEqual(executed, false, "Should not execute if cleared");
  });
});

function createRequest(platform, platformChannelId, botId) {
  return {
    channel: { platform, platformChannelId },
    botId,
  };
}
