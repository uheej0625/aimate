import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import {
  snapshot,
  compare,
  evaluate,
  checkContract,
  usageSummary,
  createEvaluationTools,
} from "../../scripts/compareCharacterPrompts.js";
import { cases } from "../../scripts/characterPromptCases.js";
import statusTool from "../../src/tools/definitions/setDiscordStatus.js";
import photoTool from "../../src/tools/definitions/generatePhoto.js";

function manager() {
  const config = {
    app: { language: "ko-KR", timezone: "Asia/Seoul" },
    ai: {
      chat: {
        provider: "gateway",
        model: "fake-model",
        prompt: "default",
        nativeTools: {},
        providerOptions: {},
      },
    },
    secrets: { aiGatewayApiKey: "fixture-secret-value" },
    tools: { maxSteps: 5 },
  };
  return {
    getAll: () => config,
    get: (key) => key.split(".").reduce((value, part) => value?.[part], config),
  };
}

async function workspace(t) {
  const root = path.resolve("test/.tmp");
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "prompt-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), root);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const promptDir = path.join(directory, "source/prompts");
  const characterDir = path.join(directory, "source/character");
  await fs.cp("test/fixtures/prompts/minimal/chat", promptDir, {
    recursive: true,
  });
  await fs.cp("test/fixtures/character", characterDir, { recursive: true });
  const baseline = path.join(directory, "baseline");
  await snapshot({ out: baseline, promptDir, characterDir });
  return {
    directory,
    promptDir,
    characterDir,
    baseline,
    out: path.join(directory, "comparison"),
  };
}

function modelResult(text = "# response\n\n## messages\n\n응, 내일 보자.") {
  return {
    text,
    steps: [{ text, toolCalls: [], toolResults: [] }],
    toolCalls: [],
    toolResults: [],
    warnings: [],
    // These raw SDK fields must never appear in saved evaluation artifacts.
    request: { headers: { authorization: "Bearer fixture-secret-value" } },
    response: { headers: { "x-secret": "fixture-secret-value" } },
  };
}

const prepared = {
  context: [{ role: "user", content: "안녕" }],
  systemInstruction: "system",
};

test("snapshot preserves all originals and refuses to overwrite a baseline", async (t) => {
  const w = await workspace(t);
  const saved = await fs.readFile(
    path.join(w.baseline, "character/identity.md"),
    "utf8",
  );
  await fs.writeFile(
    path.join(w.characterDir, "identity.md"),
    "Changed character",
  );
  assert.equal(
    await fs.readFile(path.join(w.baseline, "character/identity.md"), "utf8"),
    saved,
  );
  assert.equal(
    await fs.readFile(
      path.join(w.baseline, "prompts/default/chat/sequence.js"),
      "utf8",
    ),
    await fs.readFile(path.join(w.promptDir, "sequence.js"), "utf8"),
  );
  await assert.rejects(
    snapshot({
      out: w.baseline,
      promptDir: w.promptDir,
      characterDir: w.characterDir,
    }),
    { code: "EEXIST" },
  );
});

test("dry-run fixes character, events, time and platform across variants without model calls", async (t) => {
  const w = await workspace(t);
  await fs.writeFile(
    path.join(w.characterDir, "identity.md"),
    "Do not use this later edit",
  );
  await fs.writeFile(
    path.join(w.promptDir, "system.md"),
    "New system for {{runtime.platform}}",
  );
  const previousPlatform = process.env.PLATFORM;
  const configManager = manager();
  const originalConfig = structuredClone(configManager.getAll());
  const report = await compare({
    ...w,
    configManager,
    dryRun: true,
    generateTextFn: () => assert.fail("model called"),
  });
  assert.equal(report.results.length, cases.length);
  assert.deepEqual(configManager.getAll(), originalConfig);
  assert.equal(process.env.PLATFORM, previousPlatform);
  for (const item of cases) {
    const before = JSON.parse(
      await fs.readFile(path.join(w.out, `${item.id}-before-input.json`)),
    );
    const after = JSON.parse(
      await fs.readFile(path.join(w.out, `${item.id}-after-input.json`)),
    );
    assert.deepEqual(before.context, after.context);
    assert.deepEqual(before.tools, after.tools);
    assert.equal(after.systemInstruction, "New system for discord");
    assert.doesNotMatch(
      JSON.stringify(after.context),
      /Do not use this later edit/,
    );
    assert.equal(
      after.context.filter((entry) => entry.content.includes("## Current Time"))
        .length,
      1,
    );
    assert.match(JSON.stringify(after.context), /2026-10-02T19:00:00\+09:00/);
  }
  await assert.rejects(compare({ ...w, configManager, dryRun: true }), {
    code: "EEXIST",
  });
});

test("comparison still reads ultimate snapshots created before the rename", async (t) => {
  const w = await workspace(t);
  await fs.rename(
    path.join(w.baseline, "prompts/default"),
    path.join(w.baseline, "prompts/ultimate"),
  );
  const manifestPath = path.join(w.baseline, "snapshot.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  delete manifest.promptName;
  await fs.writeFile(manifestPath, JSON.stringify(manifest));

  const report = await compare({
    ...w,
    configManager: manager(),
    dryRun: true,
    caseId: "short",
  });

  assert.equal(report.results[0].before.status, "dry-run");
  assert.equal(report.results[0].after.status, "dry-run");
  await fs.access(path.join(w.out, "before/prompts/default/chat/sequence.js"));
  await fs.access(path.join(w.baseline, "prompts/ultimate/chat/sequence.js"));
});

test("raw contract check catches parser fallbacks, extra lines, bad separators and Markdown", () => {
  assert.deepEqual(checkContract("# response\n\n## messages\n\n안녕"), []);
  assert.deepEqual(
    checkContract("# response\n## messages\n안녕 [BREAK] 잘 지냈어?\n"),
    [],
  );
  assert.deepEqual(
    checkContract("# response\r\n\r\n## messages\r\n\r\n안녕"),
    [],
  );
  for (const text of [
    "안녕",
    "## messages\n안녕",
    "# response\n\n## messages\n첫 줄\n둘째 줄",
    "# response\n## messages\n[BREAK] 안녕",
    "# response\n## messages\n안녕 [break] 반가워",
    "# response\n## messages\n**강조**",
    "# response\n## messages\n1. 하나 2. 둘",
    "# response\n## messages\n*웃으며* 안녕",
  ]) {
    assert.ok(checkContract(text).length, text);
  }
});

test("evaluation captures original output before parser or text-tool recovery", async () => {
  const plain = await evaluate({
    prepared,
    testCase: cases[0],
    configManager: manager(),
    createLanguageModelFn: () => ({}),
    generateTextFn: async () => modelResult("안녕"),
  });
  assert.deepEqual(plain.messages, ["안녕"]);
  assert.ok(plain.violations.length);
  const recovered = await evaluate({
    prepared,
    testCase: cases.find((item) => item.id === "tool-success"),
    configManager: manager(),
    createLanguageModelFn: () => ({}),
    generateTextFn: async () =>
      modelResult(
        '{"name":"set_status_message","arguments":{"message":"봇 만드는 중"}}',
      ),
  });
  assert.equal(recovered.toolExecutions.length, 1);
  assert.match(recovered.rawText, /"name"/);
  assert.ok(recovered.violations.some((issue) => issue.includes("recovery")));
  assert.ok(
    recovered.violations.some((issue) => issue.includes("Missing native")),
  );
});

test("simulated tools retain real definitions and never need external execution context", async () => {
  const calls = [];
  const tools = createEvaluationTools(
    cases.find((item) => item.id === "tool-success"),
    calls,
  );
  assert.equal(tools.set_status_message.description, statusTool.description);
  assert.equal(tools.generate_photo.inputSchema, photoTool.inputSchema);
  assert.deepEqual(
    await tools.set_status_message.execute({ message: "봇 만드는 중" }),
    { success: true, message: "봇 만드는 중", type: "PLAYING" },
  );
  assert.match(
    (await tools.generate_photo.execute({ kind: "photo", scene: "desk" }))
      .error,
    /생성되지/,
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(createEvaluationTools(cases[0], []), {});
});

test("tool stages are checked separately and provider usage is preserved", async () => {
  const usage = {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    inputTokenDetails: { cacheReadTokens: 70 },
  };
  const result = await evaluate({
    prepared,
    testCase: cases.find((item) => item.id === "tool-success"),
    configManager: manager(),
    createLanguageModelFn: () => ({}),
    generateTextFn: async (request) => {
      const output = await request.tools.set_status_message.execute({
        message: "봇 만드는 중",
      });
      const response = modelResult();
      response.steps.unshift({
        text: "바꿨어!",
        usage,
        toolCalls: [
          {
            toolName: "set_status_message",
            input: { message: "봇 만드는 중" },
          },
        ],
        toolResults: [{ toolName: "set_status_message", output }],
      });
      response.totalUsage = usage;
      return response;
    },
  });
  assert.ok(result.violations.some((issue) => issue.includes("mixed")));
  assert.equal(result.steps[0].usage.cacheReadTokens, 70);
  assert.deepEqual(result.totalUsage, {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cacheReadTokens: 70,
  });
  assert.deepEqual(usageSummary(), {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheReadTokens: null,
  });
  assert.equal(
    usageSummary({ inputTokenDetails: { cacheReadTokens: 0 } }).cacheReadTokens,
    0,
  );
});

test("comparison persists errors and completed cases without secrets or SDK headers", async (t) => {
  const w = await workspace(t);
  let calls = 0;
  const report = await compare({
    ...w,
    configManager: manager(),
    createLanguageModelFn: () => ({}),
    generateTextFn: async (request) => {
      calls++;
      if (calls === 2) {
        request.onStepFinish({
          text: "",
          toolCalls: [],
          usage: { inputTokens: 17 },
        });
        throw new Error("API failed: fixture-secret-value");
      }
      return modelResult();
    },
  });
  assert.equal(calls, cases.length * 2);
  assert.equal(report.results[0].before.status, "completed");
  assert.equal(report.results[0].after.status, "api-error");
  assert.equal(report.results[0].after.steps[0].usage.inputTokens, 17);
  assert.equal(report.results.at(-1).after.status, "completed");
  const json = await fs.readFile(path.join(w.out, "results.json"), "utf8");
  const markdown = await fs.readFile(path.join(w.out, "report.md"), "utf8");
  assert.doesNotMatch(
    json + markdown,
    /fixture-secret-value|authorization|x-secret/,
  );
  assert.match(json, /REDACTED/);
  assert.match(markdown, /미측정/);
});

test("case filter runs one pair and invalid cases or native tools fail before creating output", async (t) => {
  const w = await workspace(t);
  await assert.rejects(
    compare({
      ...w,
      configManager: manager(),
      dryRun: true,
      caseId: "unknown",
    }),
    /Unknown case/,
  );
  const configManager = manager();
  configManager.getAll().ai.chat.nativeTools = { webSearch: true };
  await assert.rejects(
    compare({ ...w, configManager, dryRun: true }),
    /nativeTools disabled/,
  );
  const report = await compare({
    ...w,
    configManager: manager(),
    dryRun: true,
    caseId: "edit",
  });
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].id, "edit");
});
