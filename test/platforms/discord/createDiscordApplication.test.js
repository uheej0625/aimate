import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType } from "discord.js";
import { createDiscordConnection } from "../../../src/platforms/discord/createDiscordApplication.js";
import { EventBus } from "../../../src/core/EventBus.js";
import { DiscordPolicyService } from "../../../src/platforms/discord/policy/DiscordPolicyService.js";

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

test("Discord cleanup has a deadline and destroys the transport once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(DiscordPolicyService.prototype, "close", () => pending);
  let destroyed = 0;
  const connection = createDiscordConnection({
    configManager: { get: () => "fixture" },
    client: {
      destroy: async () => {
        destroyed++;
      },
    },
  });
  const closing = connection.close();
  assert.equal(connection.close(), closing);
  assert.equal(connection.isReady(), false);
  assert.equal(destroyed, 0);
  t.mock.timers.tick(5000);
  await closing;
  assert.equal(destroyed, 1);
  assert.equal(connection.state, "closed");
  release();
});

test("Discord connection uses the character DM setting for its input policy", async (t) => {
  t.mock.method(
    DiscordPolicyService.prototype,
    "isLogChannel",
    async () => false,
  );
  const client = {
    channels: { fetch: async (id) => ({ id, type: ChannelType.DM }) },
  };
  const channel = { platform: "discord", platformChannelId: "dm" };
  for (const enableDM of [true, false]) {
    const config = { character: "fixture", "features.enableDM": enableDM };
    const connection = createDiscordConnection({
      configManager: { get: (key) => config[key] },
      client,
    });
    connection.state = "active";
    assert.equal(await connection.isEnabled(channel), enableDM);
  }
});
