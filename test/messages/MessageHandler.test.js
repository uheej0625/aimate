import test from "node:test";
import assert from "node:assert";
import { MessageHandler } from "../../src/messages/MessageHandler.js";

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

    const mockMessage = createMessage();

    await handler.handle({
      message: mockMessage,
      channel: { platform: "discord", platformChannelId: "chan-123" },
      botId: "bot-1",
    });

    assert.strictEqual(bufferAdded, true, "Should add message to buffer");
  });

  await t.test("shouldHandle should filter bot messages", async () => {
    const result = await messageHandler.shouldHandle(
      createMessage({
        author: {
          platformUserId: "bot-1",
          handle: "bot",
          displayName: null,
          isBot: true,
        },
        content: "ping",
      }),
      "bot-1"
    );
    assert.strictEqual(result, false);
  });

  await t.test("shouldHandle should filter empty messages", async () => {
    const result = await messageHandler.shouldHandle(
      createMessage({ content: "  " }),
      "bot-1"
    );
    assert.strictEqual(result, false);
  });
});

function createMessage(overrides = {}) {
  return {
    platform: "discord",
    platformMessageId: "message-1",
    platformChannelId: "chan-123",
    platformServerId: null,
    content: "Hello",
    author: {
      platformUserId: "user-1",
      handle: "user",
      displayName: "User",
      isBot: false,
    },
    ...overrides,
  };
}
