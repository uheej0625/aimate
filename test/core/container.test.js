import test from "node:test";
import assert from "node:assert";
import { createCharacterConfigManager } from "../../src/config/index.js";
import { createContainer } from "../../src/core/container.js";
import { AppEvents } from "../../src/core/EventBus.js";
import { loadAiCredentials } from "../../src/ai/credentials.js";
import { createHost } from "../../src/core/host.js";
import { createDiscordConnection } from "../../src/platforms/discord/createDiscordApplication.js";
import { DiscordPolicyService } from "../../src/platforms/discord/policy/DiscordPolicyService.js";
import { DiscordLogService } from "../../src/platforms/discord/logging/DiscordLogService.js";

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

test("decision mode is composed independently and shutdown drains its active API call", async (t) => {
  const configManager = createCharacterConfigManager({
    env: { VERTEX_PROJECT_ID: "test-project" },
    watch: false,
  });
  t.after(() => configManager.close());
  configManager.setInMemory("conversation.responseMode", "decision");
  const app = await createContainer({
    configManager,
    connections: new Map([["cli", { isEnabled: () => true }]]),
    credentials: loadAiCredentials({ AI_GATEWAY_API_KEY: "test-key" }),
  });
  app.generationRepository.cancelInProgress = async () => {};
  t.after(() => app.close());
  const buffer = app.conversationBuffer;
  assert.equal(buffer.mode, "decision");
  buffer.settings.debounceMs = 1;
  buffer.settings.maxWaitMs = 1;
  buffer.contextBuilder.build = async () => ({ state: {}, throughEventId: 1 });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let signal;
  buffer.decider.evaluate = async (_state, abortSignal) => {
    signal = abortSignal;
    entered();
    return await new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  };
  const channelPort = {
    platform: "cli",
    platformChannelId: "decision-channel",
  };
  buffer.add({
    channelPort,
    internalChannelId: "internal",
    botId: "bot",
    changedMessageIds: ["m1"],
  });
  await started;
  assert.equal(buffer.tasks.size, 1);
  await app.close();
  assert.equal(signal.aborted, true);
  assert.equal(buffer.tasks.size, 0);
  assert.equal(buffer.buffers.size, 0);
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
  const session = app.conversationBuffer.conversationSession;
  const channelPort = { platform: "cli", platformChannelId: "buffered" };
  await app.conversationBuffer.add({
    channelPort,
    internalChannelId: "buffered",
  });
  const activeTurn = session.begin("active-generation");
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
  assert.equal(session.states.get(session.key(channelPort)).active, false);
  assert.equal(session.isCurrent("active-generation", activeTurn), true);
  assert.equal(cancelled, false);
  assert.deepEqual(await app.messageHandler.handle({}), { changed: false });
  finish();
  await closing;
  assert.equal(cancelled, true);
  assert.equal(session.states.size, 0);
  assert.equal(app.close(), closing);
});

test("host, runtime and Discord connection abort before waiting for an in-flight policy refresh", async (t) => {
  const configManager = createCharacterConfigManager({
    env: { VERTEX_PROJECT_ID: "test-project" },
    watch: false,
  });
  t.after(() => configManager.close());
  let releasePolicy;
  const policyWork = new Promise((resolve) => {
    releasePolicy = resolve;
  });
  t.mock.method(DiscordPolicyService.prototype, "start", function (reconcile) {
    this.refreshing = reconcile();
  });
  // Platform IO is fake; host orchestration, runtime abort and policy shutdown are real.
  t.mock.method(DiscordLogService.prototype, "start", () => {});
  const calls = [];
  const client = {
    commands: new Map(),
    on() {},
    once() {},
    user: { id: "bot", username: "fixture" },
    login: async () => {},
    destroy: async () => calls.push("transport"),
  };
  const { getDiscordTokenEnvKey } = await import(
    "../../src/platforms/discord/credentials.js"
  );
  const id = configManager.get("character");
  const connection = createDiscordConnection({
    configManager,
    client,
    env: { [getDiscordTokenEnvKey(id)]: "test-token" },
  });
  let app;
  const host = createHost({
    definitions: [{ id }],
    createCharacter: async () => ({ configManager, connections: [connection] }),
    buildRuntime: async (options) => {
      app = await createContainer({
        ...options,
        credentials: loadAiCredentials({ AI_GATEWAY_API_KEY: "test-key" }),
      });
      app.botAccountService.initBotAccount = async () => {};
      app.messageHandler.stopDisabledConversations = () => policyWork;
      app.generationRepository.cancelInProgress = async () =>
        calls.push("cancel");
      return app;
    },
    disconnectDatabase: async () => calls.push("database"),
  });
  await host.start();
  const signal = app.generationAbortRegistry.register("channel", 99);
  const closing = host.close();
  try {
    assert.equal(connection.isReady(), false);
    assert.equal(signal.aborted, true);
    await new Promise(setImmediate);
    assert.deepEqual(calls, ["cancel"]);
    assert.deepEqual(await app.messageHandler.handle({}), { changed: false });
  } finally {
    releasePolicy();
    await closing;
  }
  assert.deepEqual(calls, ["cancel", "transport", "database"]);
});
