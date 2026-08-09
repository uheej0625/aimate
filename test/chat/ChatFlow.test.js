import test from "node:test";
import assert from "node:assert";
import { ChatFlow } from "../../src/chat/ChatFlow.js";
import { AppEvents, EventBus } from "../../src/core/EventBus.js";
import { ChatGenerationFailureHandler } from "../../src/chat/ChatGenerationFailureHandler.js";
import { prisma } from "../../src/database/client.js";

test("ChatFlow tests", async (t) => {
  t.after(async () => {
    await prisma.$disconnect();
    setTimeout(() => {
      process.exit(0);
    }, 10);
  });

  const baseGenerationLifecycle = {
    findOrCreateChannel: async () => ({
      id: "channel-123",
      platform: "discord",
      platformId: "12345",
    }),
    startChatGeneration: async () => ({ id: "gen-123" }),
    recordInput: async () => {},
    markReadyToGenerate: async () => ({ shouldProceed: true }),
    recordOutput: async () => {},
    complete: async () => {},
    fail: async () => {},
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

  const baseMessageSender = {
    sendChunk: async () => true,
  };

  function createChatFlow({
    generationLifecycle = baseGenerationLifecycle,
    chatContextPreparer = baseChatContextPreparer,
    chatGenerator = baseChatGenerator,
    messageSender = baseMessageSender,
    eventBus = new EventBus(),
    failureHandler = new ChatGenerationFailureHandler(
      generationLifecycle,
      messageSender,
      eventBus,
    ),
  } = {}) {
    return new ChatFlow({
      chatContextPreparer,
      chatGenerator,
      messageSender,
      generationLifecycle,
      failureHandler,
      eventBus,
    });
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

      await chatFlow.execute(createRequest());

      assert.strictEqual(sentMessage, "Hello explorer!");
    },
  );

  await t.test("execute should handle generation cancellation", async () => {
    const generationLifecycle = {
      ...baseGenerationLifecycle,
      markReadyToGenerate: async () => ({ shouldProceed: false }),
    };

    let sendChunkCalled = false;
    const messageSender = {
      sendChunk: async () => {
        sendChunkCalled = true;
        return true;
      },
    };

    const chatFlow = createChatFlow({ generationLifecycle, messageSender });

    await chatFlow.execute(createRequest());

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
        chatFlow.execute(createRequest()),
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

    await chatFlow.execute(createRequest());

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

function createRequest() {
  return {
    channel: { platform: "discord", platformChannelId: "12345" },
    botId: "bot-1",
  };
}
