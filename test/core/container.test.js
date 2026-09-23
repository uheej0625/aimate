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
    "activateChannel",
    "botAccountService",
    "channelCatalog",
    "chatFlow",
    "conversationBuffer",
    "eventBus",
    "generationAbortRegistry",
    "generationRepository",
    "getGenerationInfo",
    "messageHandler",
    "rerollConversation",
    "storedMessageService",
  ]);
  assert.strictEqual(
    container.eventBus.listenerCount(AppEvents.GenerationCompleted),
    1,
  );
});
