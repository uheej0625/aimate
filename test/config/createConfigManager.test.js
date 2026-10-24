import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConfigManager } from "../../src/config/index.js";

function createFixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aimate-config-"));
  const configPath = path.join(directory, "config.json");
  const config = {
    ai: { chat: { model: "initial-model" } },
    secrets: {
      vertexProjectId: "",
      vertexLocation: "global",
      vertexClientEmail: "",
      vertexPrivateKey: "",
      openaiApiKey: "file-key",
    },
  };
  const writeConfig = () =>
    fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
  writeConfig();
  const manager = createConfigManager({
    configPath,
    watch: false,
    env: {},
    ...options,
  });
  t.after(async () => {
    await manager.watcher?.close();
    manager.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { manager, config, configPath, writeConfig };
}

const vertexEnv = {
  VERTEX_PROJECT_ID: "env-project",
  VERTEX_LOCATION: "env-location",
  VERTEX_CLIENT_EMAIL: "test@example.invalid",
  VERTEX_PRIVATE_KEY: "test-private-key",
};

function assertVertexCredentials(config) {
  assert.equal(config.secrets.vertexProjectId, vertexEnv.VERTEX_PROJECT_ID);
  assert.equal(config.secrets.vertexLocation, vertexEnv.VERTEX_LOCATION);
  assert.equal(config.secrets.vertexClientEmail, vertexEnv.VERTEX_CLIENT_EMAIL);
  assert.equal(config.secrets.vertexPrivateKey, vertexEnv.VERTEX_PRIVATE_KEY);
}

test("environment credentials survive explicit config reloads", (t) => {
  const { manager, config, configPath, writeConfig } = createFixture(t, {
    env: { ...vertexEnv, OPENAI_API_KEY: "env-key" },
  });
  assertVertexCredentials(manager.get());
  assert.equal(manager.get("secrets.openaiApiKey"), "env-key");

  for (const model of ["updated-model", "another-model"]) {
    config.ai.chat.model = model;
    writeConfig();
    const loaded = manager.load();
    assertVertexCredentials(loaded);
    assert.equal(manager.get("secrets.openaiApiKey"), "env-key");
    assert.equal(manager.get("ai.chat.model"), model);
  }

  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), config);
});

test("empty environment values preserve file settings after reload", (t) => {
  const { manager } = createFixture(t, {
    env: { OPENAI_API_KEY: "", VERTEX_LOCATION: "" },
  });
  manager.load();
  assert.equal(manager.get("secrets.openaiApiKey"), "file-key");
  assert.equal(manager.get("secrets.vertexLocation"), "global");
});

test(
  "file watcher reapplies credentials before notifying consumers",
  {
    timeout: 10000,
  },
  async (t) => {
    const { manager, config, writeConfig } = createFixture(t, {
      watch: true,
      env: vertexEnv,
    });
    await once(manager.watcher, "ready");
    const changed = new Promise((resolve) => {
      manager.onChange((newConfig, oldConfig) => {
        resolve({ newConfig, oldConfig, current: manager.get() });
      });
    });

    config.ai.chat.model = "updated-model";
    writeConfig();
    const { newConfig, oldConfig, current } = await changed;
    assertVertexCredentials(newConfig);
    assertVertexCredentials(oldConfig);
    assertVertexCredentials(current);
    assert.equal(oldConfig.ai.chat.model, "initial-model");
    assert.equal(newConfig.ai.chat.model, "updated-model");
  },
);
