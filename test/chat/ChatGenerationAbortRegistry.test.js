import test from "node:test";
import assert from "node:assert";
import { ChatGenerationAbortRegistry } from "../../src/chat/ChatGenerationAbortRegistry.js";

test("ChatGenerationAbortRegistry aborts all active generations without removing newer ones", () => {
  const registry = new ChatGenerationAbortRegistry();
  const first = registry.register("channel-1", 1);
  const second = registry.register("channel-1", 2);

  assert.strictEqual(registry.abortChannel("channel-1"), 2);
  assert.strictEqual(first.aborted, true);
  assert.strictEqual(second.aborted, true);

  const latest = registry.register("channel-1", 3);
  registry.unregister("channel-1", 1);

  assert.strictEqual(registry.abortChannel("channel-1"), 1);
  assert.strictEqual(latest.aborted, true);
});

test("ChatGenerationAbortRegistry abortAll cancels every active channel", () => {
  const registry = new ChatGenerationAbortRegistry();
  const channelOne = registry.register("channel-1", 1);
  const channelTwo = registry.register("channel-2", 2);

  assert.strictEqual(registry.abortAll(), 2);
  assert.strictEqual(channelOne.aborted, true);
  assert.strictEqual(channelTwo.aborted, true);
  assert.strictEqual(registry.abortAll(), 0);
});
