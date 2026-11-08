import test from "node:test";
import assert from "node:assert";
import { createCharacterConfigManager } from "../../src/config/index.js";
import { createContainer } from "../../src/core/container.js";
import { AppEvents } from "../../src/core/EventBus.js";
import { loadAiCredentials } from "../../src/ai/credentials.js";

test("createContainer exposes only application entrypoint dependencies", async (t) => {
  const configManager = createCharacterConfigManager({
    env: {
      AI_GATEWAY_API_KEY: "test-key",
      VERTEX_PROJECT_ID: "test-project",
    },
    watch: false,
  });
  t.after(() => configManager.close());

  const container = await createContainer({
    configManager,
    credentials: loadAiCredentials({ AI_GATEWAY_API_KEY: "test-key" }),
  });

  assert.deepStrictEqual(Object.keys(container).sort(), [
    "botAccountService",
    "channelCatalog",
    "characterId",
    "chatFlow",
    "close",
    "closePlatform",
    "connections",
    "conversationBuffer",
    "eventBus",
    "generationAbortRegistry",
    "generationRepository",
    "getGenerationInfo",
    "messageHandler",
    "pendingWork",
    "rerollConversation",
    "storedMessageService",
  ]);
  assert.strictEqual(
    container.eventBus.listenerCount(AppEvents.GenerationCompleted),
    0,
  );
});

test("character close aborts owned requests, blocks new work and drains before cancelling persistence", async (t) => {
  const configManager = createCharacterConfigManager({
    env: { VERTEX_PROJECT_ID: "test-project" },
    watch: false,
  });
  t.after(() => configManager.close());
  const app = await createContainer({
    configManager,
    credentials: loadAiCredentials({ AI_GATEWAY_API_KEY: "test-key" }),
  });
  const signal = app.generationAbortRegistry.register("channel", 99);
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  app.pendingWork.add(pending);
  let cancelled = false;
  app.generationRepository.cancelInProgress = async () => {
    cancelled = true;
  };
  const closing = app.close();
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, false);
  assert.deepEqual(await app.messageHandler.handle({}), { changed: false });
  finish();
  await closing;
  assert.equal(cancelled, true);
  assert.equal(app.close(), closing);
});
