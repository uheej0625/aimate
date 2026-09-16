import test from "node:test";
import assert from "node:assert";
import { MessageService } from "../../src/messages/MessageService.js";

test("MessageService tests", async (t) => {
  const mockUserRepository = {
    create: async () => ({ id: "user-123" }),
  };

  const mockPlatformAccountRepository = {
    findByPlatformId: async () => null,
    upsert: async (data) => ({ id: "pa-123", ...data }),
  };

  const mockChannelRepository = {
    upsert: async (data) => ({ id: "chan-123", ...data }),
  };

  const mockServerRepository = {
    upsert: async (data) => ({ id: "srv-123", ...data }),
  };

  const mockMessageRepository = {
    save: async (data) => ({
      message: { id: "msg-123", ...data },
      changed: true,
    }),
    updateContent: async (_platform, _platformId, content) => ({
      message: { id: "msg-123", content },
      changed: true,
    }),
    findManyByPlatformIds: async () => [],
    deleteManyByPlatformIds: async () => 0,
  };

  const messageService = new MessageService(
    mockUserRepository,
    mockPlatformAccountRepository,
    mockChannelRepository,
    mockServerRepository,
    mockMessageRepository,
  );

  await t.test(
    "saveMessage should create entities and save message",
    async () => {
      const mockMessage = {
        platform: "discord",
        platformMessageId: "platform-msg-1",
        platformChannelId: "channel-1",
        platformServerId: "guild-1",
        author: {
          platformUserId: "author-1",
          handle: "user",
          displayName: "User",
          isBot: false,
        },
        content: "Hello",
      };

      const result = await messageService.saveMessage(mockMessage);

      assert.strictEqual(result.message.content, "Hello");
      assert.strictEqual(result.channel.id, "chan-123");
      assert.strictEqual(result.platformAccount.id, "pa-123");
      assert.strictEqual(result.changed, true);
    },
  );

  await t.test(
    "saveMessage should link to generation if provided",
    async () => {
      let savedGenerationId = null;
      const linkMockMsgRepo = {
        save: async (data) => {
          savedGenerationId = data.generationId;
          return {
            message: { ...data, id: "msg-db-2" },
            changed: true,
          };
        },
      };

      const service = new MessageService(
        mockUserRepository,
        mockPlatformAccountRepository,
        mockChannelRepository,
        mockServerRepository,
        linkMockMsgRepo,
      );

      const mockMessage = {
        platform: "discord",
        platformMessageId: "m1",
        platformChannelId: "channel-1",
        platformServerId: null,
        author: {
          platformUserId: "a1",
          handle: "user",
          displayName: null,
          isBot: false,
        },
        content: "Hey",
      };

      await service.saveMessage(mockMessage, "gen-1");
      assert.strictEqual(savedGenerationId, "gen-1");
    },
  );

  await t.test("updateMessage does not create a missing message", async () => {
    let updateArgs = null;
    const service = new MessageService(
      mockUserRepository,
      mockPlatformAccountRepository,
      mockChannelRepository,
      mockServerRepository,
      {
        updateContent: async (...args) => {
          updateArgs = args;
          return { message: null, changed: false };
        },
      },
    );

    const result = await service.updateMessage({
      platform: "discord",
      platformMessageId: "missing",
      content: "edited",
    });

    assert.deepStrictEqual(updateArgs, ["discord", "missing", "edited"]);
    assert.deepStrictEqual(result, { message: null, changed: false });
  });

  await t.test("deleteMessages returns the rows that existed", async () => {
    const existing = [{ id: 1 }, { id: 2 }];
    const service = new MessageService(
      mockUserRepository,
      mockPlatformAccountRepository,
      mockChannelRepository,
      mockServerRepository,
      {
        findManyByPlatformIds: async () => existing,
        deleteManyByPlatformIds: async () => 2,
      },
    );

    const result = await service.deleteMessages("discord", ["one", "two"]);

    assert.deepStrictEqual(result, {
      deletedCount: 2,
      deletedMessages: existing,
    });
  });
});
