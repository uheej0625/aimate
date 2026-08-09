import test from "node:test";
import assert from "node:assert";
import { createConfigManager } from "../../../src/config/index.js";
import { AppEvents } from "../../../src/core/EventBus.js";
import { createDiscordApplication } from "../../../src/platforms/discord/createDiscordApplication.js";

test("createDiscordApplication registers commands and events without a service locator", async (t) => {
  const configManager = createConfigManager({
    env: { AI_GATEWAY_API_KEY: "test-key" },
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

  const app = await createDiscordApplication({ configManager, client });

  assert.strictEqual(client.commands.size, 5);
  assert.strictEqual(eventHandlers.size, 2);
  assert.strictEqual(onceHandlers.size, 1);
  assert.strictEqual("services" in client, false);
  assert.strictEqual(
    app.eventBus.listenerCount(AppEvents.GenerationServiceUnavailable),
    2,
  );
});
