import test from "node:test";
import assert from "node:assert/strict";
import { ChatFlow } from "../../src/chat/ChatFlow.js";
import { ConversationSession } from "../../src/chat/ConversationSession.js";
import { ChatGenerationAbortRegistry } from "../../src/chat/ChatGenerationAbortRegistry.js";
import { EventBus } from "../../src/core/EventBus.js";
import { createLogger } from "../../src/core/logger.js";
import { captureLogs } from "../helpers/logs.js";

test("chat logs correlate concurrent success, silence, cancellation and failures", async (t) => {
  const records = captureLogs(t);
  const downstream = createLogger("Downstream");
  await Promise.all(
    ["success", "silent", "cancelled", "failed"].map(async (id) => {
      const aborts = new ChatGenerationAbortRegistry();
      const flow = new ChatFlow({
        conversationSession: new ConversationSession(),
        generationAbortRegistry: aborts,
        eventBus: new EventBus(),
        channelRepository: { findById: async () => ({ id, platform: "cli" }) },
        generationLifecycle: {
          cancelActiveForChannel: async () => {},
          startChatGeneration: async () => ({ id: `gen-${id}` }),
          recordInput: async () => true,
          canGenerate: async () => true,
          recordGeneratedOutput: async () => ({ shouldProceed: true }),
          complete: async () => true,
          cancel: async () => true,
        },
        chatContextPreparer: {
          prepare: async () => ({
            context: [{ content: "PRIVATE_CONTEXT" }],
            messageIds: ["msg"],
            inputMessages: ["PRIVATE_INPUT"],
            systemInstruction: "PRIVATE_SYSTEM",
          }),
        },
        chatGenerator: {
          generate: async () => {
            await new Promise((resolve) => setImmediate(resolve));
            downstream.info({ event: "test.downstream" });
            if (id === "failed") throw new Error("model unavailable");
            if (id === "cancelled") aborts.abortChannel(id);
            return { messages: id === "silent" ? [] : ["PRIVATE_OUTPUT"] };
          },
        },
        messageSender: {
          send: async (_channel, _text, _generationId, delivery) => {
            delivery.onDelivered();
            return true;
          },
        },
        failureHandler: {
          handle: async () =>
            downstream.info({ event: "test.failure_handled" }),
        },
      });
      await flow.execute({
        channelPort: { platform: "cli", platformChannelId: id },
        internalChannelId: id,
        botId: "bot",
      });
    }),
  );
  for (const id of ["success", "silent", "cancelled", "failed"]) {
    const rows = records.filter((row) => row.generationId === `gen-${id}`);
    assert.ok(
      rows.every((row) => row.channelId === id && row.platformChannelId === id),
    );
    const terminal = rows.filter((row) =>
      [
        "generation.completed",
        "generation.cancelled",
        "generation.failed",
      ].includes(row.event),
    );
    assert.equal(terminal.length, 1);
    assert.equal(
      terminal[0].event,
      `generation.${id === "success" || id === "silent" ? "completed" : id}`,
    );
    assert.ok(terminal[0].durationMs >= 0);
    assert.equal(typeof terminal[0].turnId, "string");
    if (id === "silent") assert.equal(terminal[0].delivered, false);
    if (id === "failed") assert.equal(terminal[0].stage, "model");
    if (id === "cancelled") assert.equal(terminal[0].level, 30);
  }
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_/);
});
