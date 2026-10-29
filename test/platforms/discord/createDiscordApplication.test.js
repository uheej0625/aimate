import test from "node:test";
import assert from "node:assert";
import { createConfigManager } from "../../../src/config/index.js";
import { createDiscordApplication } from "../../../src/platforms/discord/createDiscordApplication.js";
import { loadAiCredentials } from "../../../src/ai/credentials.js";

test("createDiscordApplication registers commands and events without a service locator", async (t) => {
  const configManager = createConfigManager({
    env: {
      AI_GATEWAY_API_KEY: "test-key",
      VERTEX_PROJECT_ID: "test-project",
    },
    watch: false,
  });
  t.after(() => configManager.close());

  const eventHandlers = new Map();
  const onceHandlers = new Map();
  const client = {
    commands: new Map(),
    channels: {
      fetch: async () => null,
    },
    on: (name, handler) => eventHandlers.set(name, handler),
    once: (name, handler) => onceHandlers.set(name, handler),
    user: null,
  };

  const app = await createDiscordApplication({
    configManager,
    client,
    credentials: loadAiCredentials({ AI_GATEWAY_API_KEY: "test-key" }),
  });
  t.after(() => app.discordLogService.close());

  assert.strictEqual(client.commands.size, 6);
  assert.strictEqual(eventHandlers.size, 5);
  assert.strictEqual(onceHandlers.size, 1);
  assert.strictEqual("services" in client, false);

  const refresh = app.discordLogService.refresh;
  let refreshed = 0;
  app.discordLogService.refresh = () => {
    refreshed++;
    return Promise.resolve();
  };
  try {
    let changed = true;
    app.messageHandler.handle = async () => ({ changed });
    const message = {
      id: "message",
      channelId: "conversation",
      partial: true,
      channel: { id: "conversation" },
      client: { user: { id: "bot" } },
    };
    eventHandlers.get("messageCreate")(message);
    await new Promise(setImmediate);
    assert.strictEqual(
      refreshed,
      1,
      "Saved gateway observations immediately refresh the log view",
    );
    changed = false;
    eventHandlers.get("messageCreate")(message);
    await new Promise(setImmediate);
    assert.strictEqual(
      refreshed,
      1,
      "Skipped or duplicate messages do not refresh logs",
    );
  } finally {
    app.discordLogService.refresh = refresh;
  }
});
