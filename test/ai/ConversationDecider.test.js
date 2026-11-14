import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConversationDecider } from "../../src/ai/ConversationDecider.js";

const promptsRoot = fileURLToPath(
  new URL("../fixtures/prompts", import.meta.url),
);
function createDecider(settings, credentials, decide) {
  return new ConversationDecider(
    {
      get: () => ({
        provider: "gateway",
        prompt: "minimal",
        model: "parallel/parallel-decisions-fast",
        timeoutMs: 1000,
        ...settings,
      }),
    },
    credentials,
    decide,
    { promptsRoot },
  );
}

test("Decision API uses Gateway decisions with state-dependent actions and no generated text", async () => {
  const requests = [];
  const decider = createDecider(
    { model: "parallel/parallel-decisions-fast", timeoutMs: 1000 },
    { aiGatewayApiKey: "fixture" },
    async (request) => {
      requests.push(request);
      return {
        answers: {
          action: {
            choice: request.state.assistant.active ? "keep" : "respond",
          },
        },
        usage: {},
      };
    },
  );
  const signal = new AbortController().signal;
  assert.equal(
    (await decider.evaluate({ assistant: { active: false } }, signal)).action,
    "respond",
  );
  assert.equal(
    (await decider.evaluate({ assistant: { active: true } }, signal)).action,
    "keep",
  );
  assert.equal(requests[0].model.modelId, "parallel/parallel-decisions-fast");
  assert.deepEqual(Object.keys(requests[0].questions.action.criteria), [
    "respond",
    "wait",
    "ignore",
  ]);
  assert.deepEqual(Object.keys(requests[1].questions.action.criteria), [
    "keep",
    "restart",
    "stop",
    "wait",
  ]);
  assert.equal(requests[0].maxRetries, 0);
  const prompt = JSON.parse(
    await fs.readFile(
      new URL(
        "../fixtures/prompts/minimal/decision/prompt.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(requests[0].questions.action.instructions, prompt.instructions);
  assert.deepEqual(requests[0].questions.action.criteria, prompt.idle);
  assert.deepEqual(requests[1].questions.action.criteria, prompt.active);
});

test("Decision calls time out and reject actions outside the current state", async () => {
  const settings = { model: "parallel/parallel-decisions-fast", timeoutMs: 5 };
  const decider = createDecider(settings, {}, async ({ abortSignal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      abortSignal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(abortSignal.reason);
        },
        { once: true },
      );
    });
  });
  await assert.rejects(
    decider.evaluate(
      { assistant: { active: false } },
      new AbortController().signal,
    ),
    { name: "TimeoutError" },
  );
  decider.decide = async () => ({
    answers: { action: { choice: "keep" } },
    usage: {},
  });
  await assert.rejects(
    decider.evaluate(
      { assistant: { active: false } },
      new AbortController().signal,
    ),
    /Invalid conversation decision/,
  );
});

test("Decision provider and prompt pack errors fail before any API call", async (t) => {
  assert.throws(
    () => createDecider({ provider: "vertex" }, {}),
    /Unsupported Decision provider/,
  );
  await assert.rejects(createDecider({ prompt: "missing" }, {}).loadPrompt(), {
    code: "ENOENT",
  });
  await assert.rejects(
    createDecider({ prompt: "../default" }, {}).loadPrompt(),
    /prompt pack name/,
  );
  const prompt = await createDecider({}, {}).loadPrompt();
  t.mock.method(fs, "readFile", async () =>
    JSON.stringify({ ...prompt, idle: { respond: "respond" } }),
  );
  await assert.rejects(createDecider({}, {}).loadPrompt(), /idle criteria/);
});

test("Decision request is persisted before the API call without SDK credentials", async () => {
  let stored,
    called = false;
  const decider = createDecider(
    {},
    { aiGatewayApiKey: "fixture-secret-key" },
    async () => {
      called = true;
      assert.ok(stored.questions.action.instructions);
      return {
        answers: {
          action: { choice: "ignore", probabilities: { ignore: 0.99 } },
        },
        usage: { inputTokens: 12 },
        providerMetadata: { gateway: { cost: "0" } },
      };
    },
  );
  const result = await decider.evaluate(
    { assistant: { active: false } },
    new AbortController().signal,
    async (request) => {
      assert.equal(called, false);
      stored = JSON.parse(JSON.stringify(request));
    },
  );
  assert.equal(result.action, "ignore");
  assert.deepEqual(result.probabilities, { ignore: 0.99 });
  assert.equal(result.apiResponse.usage.inputTokens, 12);
  assert.deepEqual(result.apiResponse.providerMetadata, {
    gateway: { cost: "0" },
  });
  assert.equal(stored.provider, "gateway");
  assert.equal(stored.model, "parallel/parallel-decisions-fast");
  assert.doesNotMatch(
    JSON.stringify(stored),
    /fixture-secret-key|apiKey|Bearer/,
  );
  called = false;
  await assert.rejects(
    decider.evaluate(
      { assistant: { active: false } },
      new AbortController().signal,
      async () => {
        throw new Error("storage unavailable");
      },
    ),
    /storage unavailable/,
  );
  assert.equal(
    called,
    false,
    "never call the model if the request could not be persisted",
  );
});
