import test from "node:test";
import assert from "node:assert";
import { createConfigManager } from "../../src/config/index.js";
import { createContainer } from "../../src/core/container.js";
import { AppEvents } from "../../src/core/EventBus.js";

test("createContainer exposes only application entrypoint dependencies", async (t) => {
  const configManager = createConfigManager({
    env: { AI_GATEWAY_API_KEY: "test-key" },
    watch: false,
  });
  t.after(() => configManager.close());

  const container = await createContainer({ configManager });

  assert.deepStrictEqual(Object.keys(container).sort(), [
    "botAccountService",
    "channelRepository",
    "chatFlow",
    "conversationBuffer",
    "cronJobWorker",
    "eventBus",
    "messageHandler",
    "messageRepository",
    "serverRepository",
  ]);
  assert.strictEqual(
    container.eventBus.listenerCount(AppEvents.GenerationServiceUnavailable),
    1,
  );
});
