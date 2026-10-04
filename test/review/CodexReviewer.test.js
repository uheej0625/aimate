import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CodexReviewer,
  codexEnvironment,
  classifyCodexFailure,
  runProcess,
} from "../../src/review/CodexReviewer.js";
import { initialState } from "../../src/review/ReviewStore.js";
import { parseOptions } from "../../scripts/reviewChat.js";

test("initialization disables only real configured MCP servers without quoted key overrides", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "aimate-codex-review-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const judge = new CodexReviewer({
    directory,
    run: async (_command, args, options) => {
      calls.push(args);
      if (args.includes("status"))
        return { code: 0, stdout: "Logged in using ChatGPT", stderr: "" };
      if (args.includes("list"))
        return {
          code: 0,
          stdout: JSON.stringify([{ name: "my-server", enabled: true }]),
          stderr: "",
        };
      options.onEvent({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: JSON.stringify({
            nextMessage: "안녕",
            memorySummary: "",
            findings: [],
          }),
        },
      });
      options.onEvent({ type: "turn.completed" });
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  await judge.initialize();
  await judge.review(initialState("run").channels[0]);
  assert.ok(calls[1].includes("features.plugins=false"));
  assert.ok(calls[1].includes("features.apps=false"));
  assert.ok(calls[2].includes("mcp_servers.my-server.enabled=false"));
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(directory, "review-schema.json"), "utf8"),
    ).type,
    "object",
  );
});

test("API-key CLI login is refused without invoking the model", async () => {
  const judge = new CodexReviewer({
    directory: process.cwd(),
    run: async () => ({
      code: 0,
      stdout: "Logged in using an API key",
      stderr: "",
    }),
  });
  await assert.rejects(judge.initialize(), { code: "codex_auth" });
});

test("reviewer uses structured CLI output and keeps the user's default model", async () => {
  const calls = [];
  const judge = new CodexReviewer({
    directory: process.cwd(),
    env: { PATH: "path", OPENAI_API_KEY: "secret", CODEX_API_KEY: "secret" },
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      options.onEvent({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: JSON.stringify({
            nextMessage: "안녕",
            memorySummary: "",
            findings: [],
          }),
        },
      });
      options.onEvent({
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 5, output_tokens: 20 },
      });
      return { code: 0, stderr: "" };
    },
  });
  const result = await judge.review(initialState("run").channels[0]);
  assert.equal(result.review.nextMessage, "안녕");
  assert.equal(result.usage.cachedInputTokens, 5);
  assert.ok(calls[0].args.includes("--output-schema"));
  assert.ok(calls[0].args.includes("read-only"));
  assert.ok(!calls[0].args.includes("--model"));
  assert.ok(!("OPENAI_API_KEY" in calls[0].options.env));
  assert.match(calls[0].options.input, /일상과 친밀감/);
});

test("failed quota events stop even when the process exits zero", async () => {
  const judge = new CodexReviewer({
    directory: process.cwd(),
    run: async (_command, _args, options) => {
      options.onEvent({
        type: "turn.failed",
        error: { message: "usage_limit_reached" },
      });
      return { code: 0, stderr: "" };
    },
  });
  await assert.rejects(judge.review(initialState("run").channels[0]), {
    code: "codex_limit",
  });
});

test("Codex diagnostics are classified without exposing their original values", () => {
  assert.equal(
    classifyCodexFailure("429 quota exceeded private value").code,
    "codex_limit",
  );
  assert.equal(
    classifyCodexFailure("401 Unauthorized private key").code,
    "codex_auth",
  );
  assert.equal(
    classifyCodexFailure(
      "The 'some-model' model is not supported when using Codex with a ChatGPT account",
    ).code,
    "codex_model",
  );
  assert.doesNotMatch(classifyCodexFailure("failure secret").message, /secret/);
  assert.deepEqual(
    codexEnvironment({
      PATH: "yes",
      AI_GATEWAY_API_KEY: "no",
      VERTEX_PRIVATE_KEY: "no",
    }),
    { PATH: "yes" },
  );
});

test("reviewer rejects invalid and fabricated evidence", async () => {
  const judge = new CodexReviewer({
    directory: process.cwd(),
    run: async (_command, _args, options) => {
      options.onEvent({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: JSON.stringify({
            nextMessage: "안녕",
            memorySummary: "",
            findings: [
              {
                category: "context",
                severity: "high",
                turns: [99],
                description: "문제",
                suggestion: "수정",
              },
            ],
          }),
        },
      });
      options.onEvent({ type: "turn.completed" });
      return { code: 0, stderr: "" };
    },
  });
  await assert.rejects(judge.review(initialState("run").channels[0]), {
    code: "codex_output",
  });
});

test("subprocess handles literal stdin, split JSONL events and cancellation", async () => {
  const events = [];
  const result = await runProcess(
    process.execPath,
    [
      "-e",
      'process.stdin.on("data", x => { process.stdout.write(JSON.stringify({text:x.toString()})); process.stdout.write("\\n"); })',
    ],
    { input: "`$(literal) 한글", onEvent: (event) => events.push(event) },
  );
  assert.equal(result.code, 0);
  assert.equal(events[0].text, "`$(literal) 한글");
  const controller = new AbortController();
  const running = runProcess(
    process.execPath,
    ["-e", "setInterval(()=>{}, 1000)"],
    { signal: controller.signal },
  );
  setTimeout(
    () => controller.abort(new DOMException("Stop", "AbortError")),
    100,
  );
  await assert.rejects(running, { name: "AbortError" });
});

test("CLI rejects traversal and invalid turn limits", () => {
  assert.throws(() => parseOptions(["--resume", "../elsewhere"]));
  assert.throws(() => parseOptions(["--turns", "0"]));
  assert.equal(parseOptions([]).turns, Infinity);
  assert.equal(parseOptions(["--turns", "2"]).turns, 2);
});
