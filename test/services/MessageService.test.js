import test from "node:test";
import assert from "node:assert";
import { MessageService } from "../../src/services/MessageService.js";

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

  const mockGenerationRepository = {
    appendMessage: async () => {},
  };

  const messageService = new MessageService(
    mockUserRepository,
    mockPlatformAccountRepository,
    mockChannelRepository,
    mockServerRepository,
    mockMessageRepository,
    mockGenerationRepository
  );

  await t.test("saveMessage should create entities and save message", async () => {
    const mockMessage = {
      platform: "discord",
      guildId: "guild-1",
      channelId: "channel-1",
      author: { id: "author-1", username: "user", globalName: "User" },
      id: "platform-msg-1",
      content: "Hello",
    };

    const result = await messageService.saveMessage(mockMessage);

    assert.strictEqual(result.message.content, "Hello");
    assert.strictEqual(result.channel.id, "chan-123");
    assert.strictEqual(result.platformAccount.id, "pa-123");
  });

  await t.test("saveMessage should link to generation if provided", async () => {
    let linked = false;
    const linkMockGenRepo = {
      appendMessage: async (genId) => {
        if (genId === "gen-1") linked = true;
      },
    };

    const service = new MessageService(
      mockUserRepository,
      mockPlatformAccountRepository,
      mockChannelRepository,
      mockServerRepository,
      mockMessageRepository,
      linkMockGenRepo
    );

    const mockMessage = {
      platform: "discord",
      author: { id: "a1" },
      id: "m1",
      content: "Hey",
    };

    await service.saveMessage(mockMessage, "gen-1");
    assert.strictEqual(linked, true);
  });
});
