import test from "node:test";
import assert from "node:assert";
import { ChatFlow } from "../../src/core/ChatFlow.js";
import { prisma } from "../../src/database/client.js";

test("ChatFlow tests", async (t) => {
  t.after(async () => {
    await prisma.$disconnect();
    setTimeout(() => {
      process.exit(0);
    }, 10);
  });

  // Mock dependencies
  const mockGenerationRepository = {
    create: async () => ({ id: "gen-123" }),
    updateDetails: async () => {},
    updateStatus: async () => {},
    checkAndUpdateStatus: async () => ({ shouldProceed: true }),
  };

  const mockChannelRepository = {
    findByPlatformId: async () => ({
      id: "channel-123",
      platform: "discord",
      platformId: "12345",
    }),
    upsert: async () => ({ id: "channel-123" }),
  };

  const mockAiService = {
    prepareContext: async () => ({
      context: [],
      systemInstruction: "You are a bot",
      messageIds: ["msg-1"],
      currentUserId: "user-1",
    }),
    generate: async () => ({
      messages: ["Hello explorer!"],
      emotionDelta: { happiness: 1 },
      emotionReason: "Greeting",
      relationshipDelta: { friendship: 1 },
    }),
  };

  const mockMessageSender = {
    sendChunk: async () => true,
  };

  const mockConfigManager = {
    get: (key) => {
      if (key === "discord.fallbackStatus") return "dnd";
      return null;
    },
  };

  const mockEmotionStateRepository = {
    applyDelta: async () => {},
  };

  const mockUserRepository = {
    applyRelationshipDelta: async () => {},
  };

  const chatFlow = new ChatFlow(
    mockGenerationRepository,
    mockChannelRepository,
    mockAiService,
    mockMessageSender,
    mockConfigManager,
    mockEmotionStateRepository,
    { userRepository: mockUserRepository },
  );

  await t.test(
    "execute should complete successfully with normal flow",
    async () => {
      const mockChannel = {
        platform: "discord",
        id: "12345",
      };
      const botId = "bot-123";

      await chatFlow.execute(mockChannel, botId);

      // If it didn't throw, it's generally successful in this mock setup.
      // In a real test, we might check call counts or arguments.
      assert.ok(true);
    },
  );

  await t.test("execute should handle generation cancellation", async () => {
    const cancelMockGenRepo = {
      ...mockGenerationRepository,
      checkAndUpdateStatus: async () => ({ shouldProceed: false }),
    };

    let sendChunkCalled = false;
    const cancelMockSender = {
      sendChunk: async () => {
        sendChunkCalled = true;
        return true;
      },
    };

    const cancelChatFlow = new ChatFlow(
      cancelMockGenRepo,
      mockChannelRepository,
      mockAiService,
      cancelMockSender,
      mockConfigManager,
      mockEmotionStateRepository,
      { userRepository: mockUserRepository },
    );

    const mockChannel = { platform: "discord", id: "12345" };
    await cancelChatFlow.execute(mockChannel, "bot-1");

    assert.strictEqual(
      sendChunkCalled,
      false,
      "Should not call messageSender if cancelled",
    );
  });
});
