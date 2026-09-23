import test from "node:test";
import assert from "node:assert/strict";
import { registerShutdown } from "../../src/core/shutdown.js";
import { ChatGenerationAbortRegistry } from "../../src/chat/ChatGenerationAbortRegistry.js";

test("registerShutdown uses injected dependencies in shutdown order", async () => {
  const registry = new ChatGenerationAbortRegistry();
  const signal = registry.register("channel-1", 1);
  const calls = [];
  const originalExit = process.exit;
  const originalListeners = process.listeners("SIGINT");

  process.removeAllListeners("SIGINT");
  process.exit = () => calls.push("exit");

  try {
    registerShutdown({
      conversationBuffer: { clearAll: () => calls.push("buffers") },
      generationAbortRegistry: {
        abortAll: () => {
          calls.push("abort");
          registry.abortAll();
          return 1;
        },
      },
      generationRepository: {
        cancelInProgress: async () => {
          calls.push("cancel");
          return 1;
        },
      },
      client: { destroy: () => calls.push("platform") },
      disconnectDatabase: async () => calls.push("disconnect"),
    });

    process.emit("SIGINT");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(signal.aborted, true);
    assert.deepEqual(calls, [
      "buffers",
      "abort",
      "cancel",
      "platform",
      "disconnect",
      "exit",
    ]);
  } finally {
    process.removeAllListeners("SIGINT");
    for (const listener of originalListeners) process.on("SIGINT", listener);
    process.exit = originalExit;
  }
});
