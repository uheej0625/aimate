import test from "node:test";
import assert from "node:assert";
import { MessageHandler } from "../../src/messages/MessageHandler.js";

test("MessageHandler tests", async (t) => {
  const mockMessageService = {
    saveMessage: async () => ({
      channel: { id: "chan-123", platformId: "123", platform: "discord" },
      changed: true,
    }),
    updateMessage: async () => ({ changed: true }),
    deleteMessages: async () => ({ deletedCount: 0, deletedMessages: [] }),
  };

  const mockGenerationLifecycle = {
    cancelActiveForChannel: async () => {},
  };

  const mockConversationBuffer = {
    add: async () => {},
    clear: () => false,
  };

  const mockGenerationAbortRegistry = {
    abortChannel: () => {},
  };

  const mockChannelRepository = {
    findByPlatformId: async () => ({ id: "chan-123" }),
  };

  const messageHandler = new MessageHandler(
    mockMessageService,
    mockGenerationLifecycle,
    mockConversationBuffer,
    mockChannelRepository,
    mockGenerationAbortRegistry,
  );

  await t.test("handle should process message from a user", async () => {
    let bufferedRequest = null;
    const testMockBuffer = {
      add: (request) => {
        bufferedRequest = request;
      },
    };
    const calls = [];
    const generationLifecycle = {
      cancelActiveForChannel: async (channelId) =>
        calls.push(["cancel", channelId]),
    };
    const generationAbortRegistry = {
      abortChannel: (channelId) => calls.push(["abort", channelId]),
    };

    const handler = new MessageHandler(
      mockMessageService,
      generationLifecycle,
      testMockBuffer,
      mockChannelRepository,
      generationAbortRegistry,
    );

    const mockMessage = createMessage();

    const channel = { platform: "discord", platformChannelId: "chan-123" };
    await handler.handle({
      message: mockMessage,
      channel,
      botId: "bot-1",
    });

    assert.deepStrictEqual(bufferedRequest, {
      channelPort: channel,
      internalChannelId: "chan-123",
      botId: "bot-1",
    });
    assert.deepStrictEqual(calls, [
      ["abort", "chan-123"],
      ["cancel", "chan-123"],
    ]);
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
      "bot-1",
    );
    assert.strictEqual(result, false);
  });

  await t.test("shouldHandle should filter empty messages", async () => {
    const result = await messageHandler.shouldHandle(
      createMessage({ content: "  " }),
      "bot-1",
    );
    assert.strictEqual(result, false);
  });

  await t.test(
    "duplicate create should not cancel or refresh the buffer",
    async () => {
      const calls = [];
      const handler = new MessageHandler(
        {
          saveMessage: async () => ({
            channel: { id: "chan-123" },
            changed: false,
          }),
        },
        {
          cancelActiveForChannel: async () => calls.push("cancel"),
        },
        {
          add: () => calls.push("add"),
        },
        mockChannelRepository,
        {
          abortChannel: () => calls.push("abort"),
        },
      );

      await handler.handle({
        message: createMessage(),
        channel: { platform: "discord", platformChannelId: "chan-123" },
        botId: "bot-1",
      });

      assert.deepStrictEqual(calls, []);
    },
  );

  await t.test(
    "changed update refreshes an existing buffered response",
    async () => {
      const calls = [];
      const channel = { platform: "discord", platformChannelId: "chan-123" };
      const handler = new MessageHandler(
        {
          updateMessage: async () => ({ changed: true }),
        },
        {
          cancelActiveForChannel: async () => calls.push(["cancel"]),
        },
        {
          clear: () => {
            calls.push(["clear"]);
            return true;
          },
          add: (request) => calls.push(["add", request]),
        },
        mockChannelRepository,
        {
          abortChannel: () => calls.push(["abort"]),
        },
      );

      await handler.handleUpdate({
        message: createMessage({ content: "edited" }),
        channel,
        botId: "bot-1",
      });

      assert.deepStrictEqual(calls, [
        ["clear"],
        [
          "add",
          {
            channelPort: channel,
            internalChannelId: "chan-123",
            botId: "bot-1",
          },
        ],
      ]);
    },
  );

  await t.test(
    "changed update does not start a response in an idle channel",
    async () => {
      let added = false;
      const handler = new MessageHandler(
        {
          updateMessage: async () => ({ changed: true }),
        },
        {
          cancelActiveForChannel: async () => 0,
        },
        {
          clear: () => false,
          add: () => {
            added = true;
          },
        },
        mockChannelRepository,
        {
          abortChannel: () => 0,
        },
      );

      await handler.handleUpdate({
        message: createMessage({ content: "edited" }),
        channel: { platform: "discord", platformChannelId: "chan-123" },
        botId: "bot-1",
      });

      assert.strictEqual(added, false);
    },
  );

  await t.test(
    "user deletion does not start a buffer when none exists",
    async () => {
      let buffered = false;
      const channel = { platform: "discord", platformChannelId: "chan-123" };
      const handler = new MessageHandler(
        {
          deleteMessages: async () => ({
            deletedCount: 1,
            deletedMessages: [{ author: { platformId: "user-1" } }],
          }),
        },
        {
          cancelActiveForChannel: async () => {
            throw new Error("delete should not cancel an active generation");
          },
        },
        {
          clear: () => false,
          add: () => {
            buffered = true;
          },
        },
        mockChannelRepository,
        {
          abortChannel: () => {
            throw new Error("delete should not abort an active generation");
          },
        },
      );

      await handler.handleDelete({
        platform: "discord",
        platformMessageIds: ["message-1"],
        channel,
        botId: "bot-1",
      });

      assert.strictEqual(buffered, false);
    },
  );

  await t.test("user deletion refreshes an existing buffer", async () => {
    const channel = { platform: "discord", platformChannelId: "chan-123" };
    let bufferedRequest = null;
    const handler = new MessageHandler(
      {
        deleteMessages: async () => ({
          deletedCount: 1,
          deletedMessages: [{ author: { platformId: "user-1" } }],
        }),
      },
      mockGenerationLifecycle,
      {
        clear: () => true,
        add: (request) => {
          bufferedRequest = request;
        },
      },
      mockChannelRepository,
      mockGenerationAbortRegistry,
    );

    const result = await handler.handleDelete({
      platform: "discord",
      platformMessageIds: ["message-1"],
      channel,
      botId: "bot-1",
    });

    assert.strictEqual(result.refreshed, true);
    assert.deepStrictEqual(bufferedRequest, {
      channelPort: channel,
      internalChannelId: "chan-123",
      botId: "bot-1",
    });
  });

  await t.test(
    "suppressed administrator deletion does not refresh a buffer",
    async () => {
      let refreshed = false;
      const handler = new MessageHandler(
        {
          deleteMessages: async () => ({
            deletedCount: 1,
            deletedMessages: [
              { platformId: "message-1", author: { platformId: "user-1" } },
            ],
          }),
        },
        mockGenerationLifecycle,
        {
          clear: () => {
            refreshed = true;
            return true;
          },
          add: () => {},
        },
        mockChannelRepository,
        mockGenerationAbortRegistry,
        {
          consume: () => new Set(["message-1"]),
          suppress: () => {},
          release: () => {},
        },
      );

      await handler.handleDelete({
        platform: "discord",
        platformMessageIds: ["message-1"],
        channel: { platform: "discord", platformChannelId: "chan-123" },
        botId: "bot-1",
      });

      assert.strictEqual(refreshed, false);
    },
  );

  await t.test("bot deletion does not refresh a response", async () => {
    let refreshed = false;
    const handler = new MessageHandler(
      {
        deleteMessages: async () => ({
          deletedCount: 1,
          deletedMessages: [{ author: { platformId: "bot-1" } }],
        }),
      },
      mockGenerationLifecycle,
      {
        clear: () => {
          refreshed = true;
          return false;
        },
        add: () => {},
      },
      mockChannelRepository,
      mockGenerationAbortRegistry,
    );

    await handler.handleDelete({
      platform: "discord",
      platformMessageIds: ["message-1"],
      channel: { platform: "discord", platformChannelId: "chan-123" },
      botId: "bot-1",
    });

    assert.strictEqual(refreshed, false);
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
