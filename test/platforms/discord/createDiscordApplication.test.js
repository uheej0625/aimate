import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordConnection } from "../../../src/platforms/discord/createDiscordApplication.js";
import { EventBus } from "../../../src/core/EventBus.js";

test("Discord connection gates events until identity preparation and activation", async () => {
  const handlers = new Map();
  let received = 0,
    initialized = 0;
  const client = {
    commands: new Map(),
    on: (name, handler) => handlers.set(name, handler),
    once: (name, handler) => handlers.set(name, handler),
    user: { id: "bot", username: "fixture" },
    async login(token) {
      assert.equal(token, "test-token");
    },
    destroy() {},
    channels: { fetch: async () => null },
  };
  const configManager = {
    get: (key) => (key === "character" ? "fixture" : undefined),
  };
  const connection = createDiscordConnection({
    configManager,
    client,
    env: { AIMATE_DISCORD_FIXTURE_TOKEN: "test-token" },
  });
  const app = {
    pendingWork: new Set(),
    eventBus: new EventBus(),
    conversationBuffer: { buffers: new Map() },
    botAccountService: {
      async initBotAccount(account) {
        assert.equal(account.platformId, "bot");
        initialized++;
      },
    },
    messageHandler: {
      async handle() {
        received++;
        return { changed: false };
      },
      async stopDisabledConversations() {},
    },
  };
  await connection.attach(app);
  const message = {
    id: "m",
    channelId: "channel",
    partial: true,
    channel: { id: "channel" },
    client,
  };
  handlers.get("messageCreate")(message);
  await connection.prepare();
  handlers.get("messageCreate")(message);
  assert.equal(received, 0);
  assert.equal(initialized, 1);
  await connection.activate();
  handlers.get("messageCreate")(message);
  await new Promise(setImmediate);
  assert.equal(received, 1);
  await connection.close();
  handlers.get("messageCreate")(message);
  assert.equal(received, 1);
  assert.equal(client.commands.size, 6);
});
