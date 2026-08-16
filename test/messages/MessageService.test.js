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
    save: async (data) => ({ id: "msg-123", ...data }),
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
    },
  );

  await t.test(
    "saveMessage should link to generation if provided",
    async () => {
      let savedGenerationId = null;
      const linkMockMsgRepo = {
        save: async (data) => {
          savedGenerationId = data.generationId;
          return { ...data, id: "msg-db-2" };
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
});
