import test from "node:test";
import assert from "node:assert";
import { registerShutdown } from "../../src/core/shutdown.js";
import { ChatGenerationAbortRegistry } from "../../src/chat/ChatGenerationAbortRegistry.js";

test("registerShutdown aborts active model requests before cancelling generations", async () => {
  const registry = new ChatGenerationAbortRegistry();
  const signal = registry.register("channel-1", 1);
  let buffersCleared = false;
  const originalExit = process.exit;
  const originalListeners = process.listeners("SIGINT");

  process.removeAllListeners("SIGINT");
  process.exit = () => {};

  const conversationBuffer = {
    clearAll: () => {
      buffersCleared = true;
    },
  };

  registerShutdown({
    conversationBuffer,
    generationAbortRegistry: registry,
  });

  process.emit("SIGINT");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.strictEqual(signal.aborted, true);
  assert.strictEqual(buffersCleared, true);
  assert.strictEqual(registry.abortAll(), 0);

  process.removeAllListeners("SIGINT");
  for (const listener of originalListeners) {
    process.on("SIGINT", listener);
  }
  process.exit = originalExit;
});
