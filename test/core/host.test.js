import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHost } from "../../src/core/host.js";
import { drain } from "../../src/core/drain.js";

function fixture(t, { failAll = false } = {}) {
  const calls = [],
    built = [];
  const definitions = ["a", "b"].map((name) => ({
    id: `${name}-${randomUUID()}`,
  }));
  const createCharacter = async ({ id }) => ({
    configManager: { get: () => id, close: () => calls.push(`${id}:config`) },
    connections: ["discord", "test"].map((platform) => {
      const connection = {
        platform,
        client: { id },
        state: "idle",
        async attach(app) {
          connection.app = app;
        },
        async prepare() {
          calls.push(`${id}:${platform}:prepared`);
          if (failAll || (id === definitions[0].id && platform === "discord"))
            throw new Error("invalid credentials");
          connection.state = "ready";
        },
        async activate() {
          calls.push(`${id}:${platform}:active`);
          connection.state = "active";
        },
        isEnabled(channel) {
          return connection.state === "active" && channel.platform === platform;
        },
        stopInput() {
          calls.push(`${id}:${platform}:stop`);
          connection.state = "stopped";
        },
        async close() {
          calls.push(`${id}:${platform}:closed`);
          connection.state = "closed";
        },
      };
      return connection;
    }),
  });
  const host = createHost({
    definitions,
    createCharacter,
    buildRuntime: async (options) => {
      built.push(options);
      return {
        async close() {
          calls.push(`${options.configManager.get()}:runtime`);
        },
        async closePlatform(platform) {
          calls.push(`${options.configManager.get()}:${platform}:cancel`);
        },
      };
    },
    disconnectDatabase: async () => calls.push("database"),
  });
  t.after(() => host.close());
  return { host, calls, built, definitions };
}

test("one runtime owns two connections, prepares identities before input, and isolates partial failure and character shutdown", async (t) => {
  const f = fixture(t);
  await f.host.start();
  assert.equal(f.built.length, 2);
  assert.equal(f.host.failures.length, 1);
  assert.equal(f.built[0].connections.size, 2);
  const firstActive = f.calls.findIndex((value) => value.endsWith(":active"));
  assert.equal(
    f.calls.slice(firstActive).some((value) => value.endsWith(":prepared")),
    false,
  );
  const [a, b] = f.definitions;
  const bEntry = f.host.characters.get(b.id);
  assert.equal(bEntry.connections[0].app, bEntry.connections[1].app);
  assert.equal(
    await f.built[0].connections
      .get("discord")
      .isEnabled({ platform: "discord" }),
    false,
  );
  assert.equal(
    await f.built[0].connections.get("test").isEnabled({ platform: "test" }),
    true,
  );
  await f.host.closeCharacter(a.id);
  assert.equal(bEntry.connections[0].state, "active");
  await f.host.closeConnection(b.id, "discord");
  assert.equal(bEntry.connections[1].state, "active");
  assert.ok(f.calls.includes(`${b.id}:discord:cancel`));
  assert.equal(f.calls.includes("database"), false);
  await Promise.all([f.host.close(), f.host.close()]);
  assert.equal(f.calls.filter((value) => value === "database").length, 1);
  assert.equal(f.calls.at(-1), "database");
  assert.ok(
    f.calls.indexOf(`${b.id}:runtime`) <
      f.calls.lastIndexOf(`${b.id}:discord:closed`),
  );
});

test("no usable connection fails startup and closes common resources once", async (t) => {
  const f = fixture(t, { failAll: true });
  await assert.rejects(f.host.start(), /invalid credentials/);
  assert.equal(f.host.failures.length, 4);
  assert.equal(f.calls.filter((value) => value === "database").length, 1);
  assert.equal(f.host.characters.size, 0);
});

test("duplicate runtime IDs fail before any resources are built", async () => {
  const host = createHost({
    definitions: [{ id: "same" }, { id: "same" }],
    createCharacter: () => assert.fail("must reject duplicates first"),
  });
  await assert.rejects(host.start(), /Duplicate active character/);
  await host.close();
});

test("draining uncooperative work has a bounded deadline", async () => {
  await drain([new Promise(() => {})], 5);
});

test("shutdown starts every character's cancellation before waiting for slow work", async (t) => {
  const f = fixture(t);
  await f.host.start();
  const [a, b] = f.definitions;
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  f.host.characters.get(a.id).app.close = () => {
    f.calls.push("a:abort");
    return slow;
  };
  f.host.characters.get(b.id).app.close = async () => f.calls.push("b:abort");
  const closing = f.host.close();
  try {
    await new Promise(setImmediate);
    assert.ok(f.calls.includes("a:abort"));
    assert.ok(f.calls.includes("b:abort"));
    assert.equal(f.calls.includes("database"), false);
  } finally {
    release();
    await closing;
  }
});

test("a second host cannot create another active runtime for the same character", async (t) => {
  const f = fixture(t);
  await f.host.start();
  const duplicate = createHost({
    definitions: f.definitions,
    createCharacter: () => assert.fail("Character already owned"),
  });
  await assert.rejects(duplicate.start(), /already active/);
  assert.equal(f.host.characters.size, 2);
});

test("shutdown while building a character never activates it after the database closes", async () => {
  let finish, entered;
  const building = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const calls = [];
  const host = createHost({
    definitions: [{ id: randomUUID() }],
    createCharacter: async () => {
      entered();
      await gate;
      return {
        configManager: { close: () => calls.push("config") },
        connections: [{ close: async () => calls.push("connection") }],
      };
    },
    buildRuntime: () => assert.fail("Do not build after shutdown"),
    disconnectDatabase: async () => calls.push("database"),
  });
  const starting = host.start();
  await building;
  await host.close();
  finish();
  await starting;
  assert.deepEqual(calls, ["database", "connection", "config"]);
});
