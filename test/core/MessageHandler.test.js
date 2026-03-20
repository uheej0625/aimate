import test from "node:test";
import assert from "node:assert";
import { MessageHandler } from "../../src/core/MessageHandler.js";

test("MessageHandler tests", async (t) => {
  const mockMessageService = {
    saveMessage: async () => ({
      channel: { id: "chan-123", platformId: "123", platform: "discord" }
    }),
  };

  const mockGenerationRepository = {
    cancelProcessing: async () => {},
  };

  const mockConversationBuffer = {
    add: async () => {},
  };

  const mockChannelRepository = {
    findByPlatformId: async () => ({ id: "chan-123" }),
  };

  const messageHandler = new MessageHandler(
    mockMessageService,
    mockGenerationRepository,
    mockConversationBuffer,
    mockChannelRepository
  );

  await t.test("handle should process message from a user", async () => {
    let bufferAdded = false;
    const testMockBuffer = {
      add: () => { bufferAdded = true; }
    };

    const handler = new MessageHandler(
      mockMessageService,
      mockGenerationRepository,
      testMockBuffer,
      mockChannelRepository
    );

    const mockMessage = {
      author: { id: "user-1" },
      client: { user: { id: "bot-1" } },
      channelId: "chan-123",
      channel: { id: "chan-123" },
      content: "Hello",
      platform: "discord"
    };

    await handler.handle(mockMessage);

    assert.strictEqual(bufferAdded, true, "Should add message to buffer");
  });

  await t.test("shouldHandle should filter bot messages", async () => {
    const result = await messageHandler.shouldHandle(
      { author: { id: "bot-1" }, content: "ping" },
      "bot-1"
    );
    assert.strictEqual(result, false);
  });

  await t.test("shouldHandle should filter empty messages", async () => {
    const result = await messageHandler.shouldHandle(
      { author: { id: "user-1" }, content: "  " },
      "bot-1"
    );
    assert.strictEqual(result, false);
  });
});
