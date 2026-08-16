import test from "node:test";
import assert from "node:assert";
import { ChatFlow } from "../../src/chat/ChatFlow.js";
import { AppEvents, EventBus } from "../../src/core/EventBus.js";
import { ChatGenerationFailureHandler } from "../../src/chat/ChatGenerationFailureHandler.js";
import { ChatGenerationAbortRegistry } from "../../src/chat/ChatGenerationAbortRegistry.js";
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
    canGenerate: async () => true,
    recordGeneratedOutput: async () => ({ shouldProceed: true }),
    complete: async () => true,
    cancel: async () => true,
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
    generationAbortRegistry = new ChatGenerationAbortRegistry(),
  } = {}) {
    return new ChatFlow({
      chatContextPreparer,
      chatGenerator,
      messageSender,
      generationLifecycle,
      failureHandler,
      eventBus,
      generationAbortRegistry,
    });
  }

  await t.test(
    "execute cancels an aborted model request without failing the generation",
    async () => {
      const registry = new ChatGenerationAbortRegistry();
      const cancelled = [];
      let failureHandled = false;
      let cancellationEvent = null;
      const eventBus = new EventBus();
      eventBus.on(AppEvents.GenerationCancelled, async (payload) => {
        cancellationEvent = payload;
      });
      const generationLifecycle = {
        ...baseGenerationLifecycle,
        cancel: async (generationId) => cancelled.push(generationId),
      };
      const chatGenerator = {
        generate: async (...args) => {
          const { abortSignal } = args.at(-1);
          assert.strictEqual(abortSignal.aborted, false);

          return await new Promise((_, reject) => {
            abortSignal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
            registry.abortChannel("channel-123");
          });
        },
      };
      const failureHandler = {
        handle: async () => {
          failureHandled = true;
        },
      };

      const chatFlow = createChatFlow({
        generationLifecycle,
        chatGenerator,
        failureHandler,
        eventBus,
        generationAbortRegistry: registry,
      });

      await chatFlow.execute(createRequest());

      assert.deepStrictEqual(cancelled, ["gen-123"]);
      assert.strictEqual(failureHandled, false);
      assert.strictEqual(cancellationEvent.reason, "aborted_during_generation");
    },
  );

  await t.test(
    "execute does not emit completion when cancellation wins before completion",
    async () => {
      const eventBus = new EventBus();
      let completed = false;
      let cancelled = false;
      eventBus.on(AppEvents.GenerationCompleted, async () => {
        completed = true;
      });
      eventBus.on(AppEvents.GenerationCancelled, async () => {
        cancelled = true;
      });
      const generationLifecycle = {
        ...baseGenerationLifecycle,
        complete: async () => false,
      };
      const chatFlow = createChatFlow({ generationLifecycle, eventBus });

      await chatFlow.execute(createRequest());

      assert.strictEqual(completed, false);
      assert.strictEqual(cancelled, true);
    },
  );

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
      canGenerate: async () => false,
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
    "execute stops when cancellation wins before input recording",
    async () => {
      const eventBus = new EventBus();
      let cancellationReason = null;
      let generateCalled = false;
      eventBus.on(AppEvents.GenerationCancelled, async ({ reason }) => {
        cancellationReason = reason;
      });
      const generationLifecycle = {
        ...baseGenerationLifecycle,
        recordInput: async () => false,
      };
      const chatGenerator = {
        generate: async () => {
          generateCalled = true;
        },
      };

      const chatFlow = createChatFlow({
        generationLifecycle,
        chatGenerator,
        eventBus,
      });

      await chatFlow.execute(createRequest());

      assert.strictEqual(generateCalled, false);
      assert.strictEqual(
        cancellationReason,
        "cancelled_before_input_record",
      );
    },
  );

  await t.test(
    "execute should stop when cancelled during model generation",
    async () => {
      let generated = false;
      const generationLifecycle = {
        ...baseGenerationLifecycle,
        recordGeneratedOutput: async () => ({ shouldProceed: false }),
      };
      const chatGenerator = {
        generate: async () => {
          generated = true;
          return { messages: ["late response"] };
        },
      };
      let sendChunkCalled = false;
      const messageSender = {
        sendChunk: async () => {
          sendChunkCalled = true;
          return true;
        },
      };

      const chatFlow = createChatFlow({
        generationLifecycle,
        chatGenerator,
        messageSender,
      });

      await chatFlow.execute(createRequest());

      assert.strictEqual(generated, true);
      assert.strictEqual(sendChunkCalled, false);
    },
  );

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

      await assert.doesNotReject(chatFlow.execute(createRequest()));
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
