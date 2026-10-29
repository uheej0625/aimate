import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";
import {
  createConfigManager,
  getDefaultConfigPath,
} from "../../src/config/index.js";
import { captureLogs } from "../helpers/logs.js";

function createFixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aimate-config-"));
  const configPath = path.join(directory, "config.yaml");
  const config = {
    ai: {
      chat: { model: "initial-model" },
      vertex: { projectId: "file-project", location: "global" },
    },
  };
  const writeConfig = () =>
    fs.writeFileSync(configPath, stringify(config), "utf8");
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

function assertGeneralSettings(config) {
  assert.equal(config.ai.vertex.projectId, vertexEnv.VERTEX_PROJECT_ID);
  assert.equal(config.ai.vertex.location, vertexEnv.VERTEX_LOCATION);
  assert.equal(config.secrets, undefined);
  assert.doesNotMatch(
    JSON.stringify(config),
    /test-private-key|test@example.invalid|env-key/,
  );
}

test("default configuration loads from the YAML file", (t) => {
  const manager = createConfigManager({ watch: false, env: {} });
  t.after(() => manager.close());
  assert.equal(path.basename(getDefaultConfigPath()), "default.yaml");
  assert.equal(typeof manager.get("character"), "string");
  assert.equal(typeof manager.get("ai.chat.provider"), "string");
  assert.equal(manager.get("secrets"), undefined);
});

test("YAML types and comments survive loading and memory overrides", (t) => {
  const { manager, configPath } = createFixture(t, {
    env: { OPENAI_API_KEY: "env-key" },
  });
  const source = `# Human-edited configuration
ai:
  chat:
    model: openai/test-model
    maxOutputTokens: null # Use provider default
    nativeTools:
      webSearch: false
    providerOptions: {}
conversation:
  bufferTimeout: 5000 # ms
discord:
  commandPrefix: "!"
  activityName: 채팅 중...
`;
  fs.writeFileSync(configPath, source, "utf8");
  manager.load();
  assert.equal(manager.get("ai.chat.model"), "openai/test-model");
  assert.equal(manager.get("ai.chat.maxOutputTokens"), null);
  assert.equal(manager.get("ai.chat.nativeTools.webSearch"), false);
  assert.deepEqual(manager.get("ai.chat.providerOptions"), {});
  assert.equal(manager.get("conversation.bufferTimeout"), 5000);
  assert.equal(manager.get("discord.commandPrefix"), "!");
  assert.equal(manager.get("discord.activityName"), "채팅 중...");
  assert.equal(manager.get("secrets"), undefined);
  assert.doesNotMatch(JSON.stringify(manager.getAll()), /env-key/);
  manager.setInMemory("ai.chat.model", "another-model");
  assert.equal(manager.get("ai.chat.model"), "another-model");
  manager.load();
  assert.equal(manager.get("ai.chat.model"), "openai/test-model");
  assert.equal(fs.readFileSync(configPath, "utf8"), source);
});

test("invalid YAML and non-mapping roots fail to load", async (t) => {
  const { manager, configPath } = createFixture(t);
  const records = captureLogs(t);
  const invalidSources = [
    "ai: [",
    "character: first\ncharacter: second\n",
    "",
    "null\n",
    "plain scalar\n",
    "- item\n",
    "secrets:\n  openaiApiKey: PRIVATE_SENTINEL\n",
    "ai:\n  chat:\n    apiKey: PRIVATE_SENTINEL\n",
  ];
  for (const source of invalidSources) {
    fs.writeFileSync(configPath, source, "utf8");
    assert.equal(manager.load(), null);
    assert.deepEqual(manager.get(), {});
  }
  assert.equal(records.length, invalidSources.length);
  assert.ok(records.every((record) => record.event === "config.load.failed"));
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_SENTINEL/);
});

test("reload applies only non-secret environment settings", (t) => {
  const { manager, config, configPath, writeConfig } = createFixture(t, {
    env: { ...vertexEnv, OPENAI_API_KEY: "env-key" },
  });
  assertGeneralSettings(manager.getAll());

  for (const model of ["updated-model", "another-model"]) {
    config.ai.chat.model = model;
    writeConfig();
    const loaded = manager.load();
    assertGeneralSettings(loaded);
    assert.equal(manager.get("ai.chat.model"), model);
  }

  assert.deepEqual(parse(fs.readFileSync(configPath, "utf8")), config);
});

test("empty environment values preserve file settings after reload", (t) => {
  const { manager } = createFixture(t, {
    env: { OPENAI_API_KEY: "", VERTEX_LOCATION: "" },
  });
  manager.load();
  assert.equal(manager.get("secrets"), undefined);
  assert.equal(manager.get("ai.vertex.location"), "global");
});

test(
  "file watcher notifies consumers with general settings only",
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
    assertGeneralSettings(newConfig);
    assertGeneralSettings(oldConfig);
    assertGeneralSettings(current);
    assert.equal(oldConfig.ai.chat.model, "initial-model");
    assert.equal(newConfig.ai.chat.model, "updated-model");
  },
);
