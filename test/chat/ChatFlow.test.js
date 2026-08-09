import test from "node:test";
import assert from "node:assert";
import { ChatFlow } from "../../src/chat/ChatFlow.js";
import { AppEvents, EventBus } from "../../src/core/EventBus.js";
import { prisma } from "../../src/database/client.js";

test("ChatFlow tests", async (t) => {
  t.after(async () => {
    await prisma.$disconnect();
    setTimeout(() => {
      process.exit(0);
    }, 10);
  });

  const baseGenerationRepository = {
    create: async () => ({ id: "gen-123" }),
    updateDetails: async () => {},
    updateStatus: async () => {},
    checkAndUpdateStatus: async () => ({ shouldProceed: true }),
  };

  const baseChannelRepository = {
    findByPlatformId: async () => ({
      id: "channel-123",
      platform: "discord",
      platformId: "12345",
    }),
    upsert: async () => ({ id: "channel-123" }),
  };

  const baseChatContextPreparer = {
    prepare: async () => ({
      context: [],
      systemInstruction: "You are a bot",
      messageIds: ["msg-1"],
      inputMessages: ["hello"],
    }),
  };

  const baseChatGenerator = {
    generate: async () => ({ messages: ["Hello explorer!"] }),
  };

  const baseMessageRepository = {
    addGenerationId: async () => {},
  };

  const baseMessageSender = {
    sendChunk: async () => true,
  };

  const baseConfigManager = {
    get: (key) => {
      if (key === "discord.fallbackStatus") return "dnd";
      if (key === "ai.chat.prompt") return "minimal";
      return null;
    },
  };

  function createChatFlow({
    generationRepository = baseGenerationRepository,
    channelRepository = baseChannelRepository,
    messageRepository = baseMessageRepository,
    chatContextPreparer = baseChatContextPreparer,
    chatGenerator = baseChatGenerator,
    messageSender = baseMessageSender,
    configManager = baseConfigManager,
    eventBus = new EventBus(),
  } = {}) {
    return new ChatFlow(
      generationRepository,
      channelRepository,
      messageRepository,
      chatContextPreparer,
      chatGenerator,
      messageSender,
      configManager,
      { eventBus },
    );
  }

  await t.test(
    "execute should complete successfully with normal flow",
    async () => {
      let sentMessage = null;
      const messageSender = {
        sendChunk: async (_channel, message) => {
          sentMessage = message;
          return true;
        },
      };
      const chatFlow = createChatFlow({ messageSender });

      await chatFlow.execute({ platform: "discord", id: "12345" }, "bot-123");

      assert.strictEqual(sentMessage, "Hello explorer!");
    },
  );

  await t.test("execute should handle generation cancellation", async () => {
    const generationRepository = {
      ...baseGenerationRepository,
      checkAndUpdateStatus: async () => ({ shouldProceed: false }),
    };

    let sendChunkCalled = false;
    const messageSender = {
      sendChunk: async () => {
        sendChunkCalled = true;
        return true;
      },
    };

    const chatFlow = createChatFlow({ generationRepository, messageSender });

    await chatFlow.execute({ platform: "discord", id: "12345" }, "bot-1");

    assert.strictEqual(
      sendChunkCalled,
      false,
      "Should not call messageSender if cancelled",
    );
  });

  await t.test(
    "execute should handle AI generation failure gracefully",
    async () => {
      const chatGenerator = {
        ...baseChatGenerator,
        generate: async () => {
          throw new Error("AI Timeout or failure");
        },
      };

      const chatFlow = createChatFlow({ chatGenerator });

      await assert.doesNotReject(
        chatFlow.execute({ platform: "discord", id: "12345" }, "bot-1"),
      );
    },
  );

  await t.test("execute should emit service unavailable events", async () => {
    const eventBus = new EventBus();
    let serviceUnavailablePayload = null;
    let fallbackMessageSent = false;

    eventBus.on(AppEvents.GenerationServiceUnavailable, async (payload) => {
      serviceUnavailablePayload = payload;
    });

    const chatGenerator = {
      ...baseChatGenerator,
      generate: async () => {
        const error = new Error("overloaded");
        error.status = 503;
        throw error;
      },
    };

    const messageSender = {
      sendChunk: async () => {
        fallbackMessageSent = true;
        return true;
      },
    };

    const chatFlow = createChatFlow({
      chatGenerator,
      messageSender,
      eventBus,
    });

    await chatFlow.execute({ platform: "discord", id: "12345" }, "bot-1");

    assert.strictEqual(serviceUnavailablePayload.platform, "discord");
    assert.strictEqual(
      serviceUnavailablePayload.channelRecord.id,
      "channel-123",
    );
    assert.strictEqual(
      fallbackMessageSent,
      false,
      "Should not send fallback messages for overload errors",
    );
  });
});
