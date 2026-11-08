import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import {
  createCharacterConfigManager,
  createConfigManager,
} from "../../src/config/index.js";
import { getCharacterDefinitions } from "../../src/config/characters.js";
import { getRequiredDiscordToken } from "../../src/platforms/discord/credentials.js";

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "aimate-characters-"),
  );
  const configPath = path.join(directory, "settings.yaml");
  const config = {
    character: "alice",
    characters: [
      {
        id: "alice",
        connections: { discord: {}, cli: {} },
        settings: { ai: { chat: { model: "alice-model" } } },
      },
      {
        id: "bob",
        connections: { discord: {} },
        settings: { humanize: { enabled: false } },
      },
    ],
    ai: {
      chat: { provider: "openai", model: "shared-model", maxOutputTokens: 100 },
      vertex: { location: "global" },
    },
    humanize: { enabled: true },
    logging: { level: "info" },
  };
  const write = () => fs.writeFileSync(configPath, stringify(config));
  write();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const create = (options = {}) => {
    const manager = createCharacterConfigManager({
      configPath,
      env: {},
      watch: false,
      ...options,
    });
    t.after(() => manager.close());
    return manager;
  };
  return { config, configPath, write, create };
}

test("characters inherit common settings without exposing or mutating another character's settings", (t) => {
  const f = fixture(t);
  const alice = f.create();
  const bob = f.create({ characterId: "bob" });
  assert.equal(alice.get("character"), "alice");
  assert.equal(bob.get("character"), "bob");
  assert.equal(alice.get("ai.chat.model"), "alice-model");
  assert.equal(bob.get("ai.chat.model"), "shared-model");
  assert.equal(alice.get("ai.chat.provider"), "openai");
  assert.equal(alice.get("humanize.enabled"), true);
  assert.equal(bob.get("humanize.enabled"), false);
  assert.equal(alice.get("characters"), undefined);
  assert.doesNotMatch(JSON.stringify(bob.getAll()), /alice-model/);
  alice.setInMemory("ai.chat.model", "changed");
  assert.equal(bob.get("ai.chat.model"), "shared-model");
  assert.equal(f.config.ai.chat.model, "shared-model");
});

test("reload keeps identity and connections fixed and updates only that character's settings", (t) => {
  const f = fixture(t);
  const alice = f.create();
  const bob = f.create({ characterId: "bob" });
  f.config.character = "bob";
  f.config.characters[0].connections = { cli: {} };
  f.config.characters[0].settings.ai.chat.model = "new-alice-model";
  f.config.ai.chat.maxOutputTokens = 200;
  f.write();
  alice.load();
  bob.load();
  assert.equal(alice.get("character"), "alice");
  assert.deepEqual(alice.get("connections"), { discord: {}, cli: {} });
  assert.equal(alice.get("ai.chat.model"), "new-alice-model");
  assert.equal(bob.get("ai.chat.model"), "shared-model");
  assert.equal(alice.get("ai.chat.maxOutputTokens"), 200);
  assert.equal(bob.get("ai.chat.maxOutputTokens"), 200);
  const restarted = f.create({ characterId: "alice" });
  assert.deepEqual(restarted.get("connections"), { cli: {} });
});

test("environment overrides remain separate from per-character settings and Discord tokens", (t) => {
  const f = fixture(t);
  const env = {
    VERTEX_LOCATION: "env-region",
    AIMATE_DISCORD_ALICE_TOKEN: "alice-token",
    AIMATE_DISCORD_BOB_TOKEN: "bob-token",
    OPENAI_API_KEY: "private-sentinel",
  };
  const alice = f.create({ env });
  const bob = f.create({ characterId: "bob", env });
  assert.equal(alice.get("ai.vertex.location"), "env-region");
  assert.equal(getRequiredDiscordToken(alice, env), "alice-token");
  assert.equal(getRequiredDiscordToken(bob, env), "bob-token");
  assert.doesNotMatch(
    JSON.stringify(alice.getAll()),
    /private-sentinel|alice-token|bob-token/,
  );
});

test("an invalid character reload preserves its settings without blocking another character", (t) => {
  const f = fixture(t);
  const alice = f.create();
  const bob = f.create({ characterId: "bob" });
  const previous = alice.getAll();
  f.config.characters[0].settings.typo = true;
  f.config.characters[1].settings.humanize.enabled = true;
  f.write();
  assert.equal(alice.load(), null);
  assert.deepEqual(alice.getAll(), previous);
  assert.ok(bob.load());
  assert.equal(bob.get("character"), "bob");
  assert.equal(bob.get("humanize.enabled"), true);
  f.config.characters.shift();
  f.write();
  assert.equal(alice.load(), null);
  assert.deepEqual(alice.getAll(), previous);
  assert.ok(bob.load());
});

test("one source reload updates isolated character views and closing a view unsubscribes it", (t) => {
  const f = fixture(t);
  const source = createConfigManager({
    configPath: f.configPath,
    env: {},
    watch: false,
  });
  t.after(() => source.close());
  const alice = f.create({ source });
  const bob = f.create({ source, characterId: "bob" });
  const changes = [];
  bob.onChange((next) => changes.push(next));
  assert.equal(alice.watcher, null);
  assert.equal(bob.watcher, null);
  const previousAlice = alice.getAll();
  f.config.characters[0].settings.typo = true;
  f.config.characters[1].settings.humanize.enabled = true;
  f.write();
  source.load();
  assert.deepEqual(alice.getAll(), previousAlice);
  assert.equal(bob.get("humanize.enabled"), true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].characters, undefined);
  assert.equal(source.get("characters")[0].id, "alice");
  bob.close();
  f.config.characters[1].settings.humanize.enabled = false;
  f.write();
  source.load();
  assert.equal(changes.length, 1);
  assert.equal(bob.get("humanize.enabled"), true);
});

test("character list rejects duplicate IDs, unsupported connections, invalid IDs and misplaced settings", (t) => {
  const f = fixture(t);
  const validate = () =>
    getCharacterDefinitions({ get: () => f.config.characters });
  f.config.characters[1].id = "alice";
  assert.throws(validate, /Duplicate character ID/);
  f.config.characters[1].id = "../invalid";
  assert.throws(validate, /Invalid character ID/);
  f.config.characters[1].id = "bob";
  f.config.characters[1].connections = { instagram: {} };
  assert.throws(validate, /connection mappings/);
  f.config.characters[1].connections = {
    discord: { token: "private-sentinel" },
  };
  assert.throws(validate, /connection mappings/);
  f.config.characters[1].connections = { discord: {} };
  f.config.characters[1].settings = { character: "alice" };
  assert.throws(validate, /settings support/);
});

test("unknown selected characters and inline credentials in unselected characters fail startup", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.create({ characterId: "unknown" }),
    /Character is not configured/,
  );
  f.config.characters[1].settings.ai = { chat: { apiKey: "private-sentinel" } };
  f.write();
  assert.throws(() => f.create(), /Credentials belong in the environment/);
});

test(
  "watcher notifications contain only the selected character's effective settings",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    const source = createConfigManager({
      configPath: f.configPath,
      env: {},
      watch: true,
    });
    t.after(() => source.close());
    const alice = f.create({ source, watch: true });
    assert.equal(alice.watcher, null);
    await once(source.watcher, "ready");
    const changed = new Promise((resolve) =>
      alice.onChange((next, previous) => resolve({ next, previous })),
    );
    f.config.characters[0].settings.ai.chat.model = "updated-model";
    f.write();
    const { next, previous } = await changed;
    assert.equal(previous.ai.chat.model, "alice-model");
    assert.equal(next.ai.chat.model, "updated-model");
    assert.equal(next.characters, undefined);
    await source.close();
  },
);
