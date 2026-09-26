import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function runStartup(t, changeConfig = () => {}, token = "test-token") {
  const directory = await mkdtemp(path.join(tmpdir(), "aimate-startup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await cp(path.join(projectRoot, "src"), path.join(directory, "src"), {
    recursive: true,
  });
  await symlink(
    path.join(projectRoot, "node_modules"),
    path.join(directory, "node_modules"),
    "dir",
  );
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}');
  await mkdir(path.join(directory, "config"));
  const config = {
    character: "startup-test",
    ai: {
      chat: { provider: "openai", model: "test-model", prompt: "minimal" },
      image: { provider: "openai", model: "test-image", prompt: "minimal" },
    },
    secrets: { openaiApiKey: "test-key" },
  };
  changeConfig(config);
  await writeFile(
    path.join(directory, "config/default.json"),
    JSON.stringify(config),
  );
  // Keep the real startup path, but never connect to Discord in these tests.
  await writeFile(
    path.join(directory, "src/platforms/discord/client.js"),
    `
export default {
  commands: new Map(),
  on() {},
  once() {},
  async login() { throw new Error("synthetic connection failure"); },
};
`,
  );

  return spawnSync(process.execPath, ["src/platforms/discord/index.js"], {
    cwd: directory,
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      DATABASE_URL: `file:${path.join(directory, "unused.db")}`,
      AIMATE_DISCORD_STARTUP_TEST_TOKEN: token,
    },
    encoding: "utf8",
    timeout: 15000,
  });
}

function assertFailure(result, exitCode, message) {
  assert.ifError(result.error);
  assert.strictEqual(result.status, exitCode, result.stdout + result.stderr);
  assert.match(result.stdout, message);
  assert.strictEqual((result.stdout.match(/Failed to start bot/g) ?? []).length, 1);
}

test("Discord startup exits with 78 for invalid native tool configuration", async (t) => {
  const result = await runStartup(t, (config) => {
    config.ai.chat.nativeTools = { webSearch: true };
  });
  assertFailure(result, 78, /nativeTools에는 dialect가 필요합니다/);
});

test("Discord startup exits with 78 for missing AI credentials", async (t) => {
  const result = await runStartup(t, (config) => {
    delete config.secrets.openaiApiKey;
  });
  assertFailure(result, 78, /OPENAI_API_KEY/);
});

test("Discord startup exits with 78 for a missing Discord token", async (t) => {
  const result = await runStartup(t, undefined, "");
  assertFailure(result, 78, /AIMATE_DISCORD_STARTUP_TEST_TOKEN/);
});

test("Discord startup exits with 78 for an invalid character ID", async (t) => {
  const result = await runStartup(t, (config) => {
    config.character = "../invalid";
  });
  assertFailure(result, 78, /Invalid character ID/);
});

test("Discord startup keeps ordinary login failures retryable with exit code 1", async (t) => {
  const result = await runStartup(t);
  assertFailure(result, 1, /synthetic connection failure/);
});
