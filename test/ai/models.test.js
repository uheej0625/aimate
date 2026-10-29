import test from "node:test";
import assert from "node:assert";
import { createServer } from "node:http";
import { once } from "node:events";
import { createLanguageModel as createModel } from "../../src/ai/models.js";

import { loadAiCredentials } from "../../src/ai/credentials.js";
const credentials = loadAiCredentials({ XAI_API_KEY: "xai-test-key" });
function createLanguageModel(config) {
  return createModel(config, "chat", credentials);
}

function createConfig(settings) {
  return {
    get: (key) =>
      ({
        "ai.chat": settings,
      })[key],
  };
}

test("model requests use the separate credential snapshot without adding it to config", async (t) => {
  let authorization;
  let requestBody;
  const server = createServer(async (request, response) => {
    authorization = request.headers.authorization;
    let body = "";
    for await (const chunk of request) body += chunk;
    requestBody = body;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "test-response",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hello" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const env = { OPENAI_COMPATIBLE_API_KEY: "snapshot-key" };
  const authentication = loadAiCredentials(env);
  env.OPENAI_COMPATIBLE_API_KEY = "changed-key";
  const settings = {
    provider: "openaiCompatible",
    model: "test-model",
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
  };
  const config = createConfig(settings);
  const model = createModel(config, "chat", authentication);
  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  });
  assert.strictEqual(authorization, "Bearer snapshot-key");
  assert.doesNotMatch(requestBody, /snapshot-key|changed-key/);
  assert.doesNotMatch(
    JSON.stringify(settings),
    /snapshot-key|changed-key|apiKey/,
  );
});

test("direct xAI Responses configuration creates a Responses model", () => {
  const model = createLanguageModel(
    createConfig({
      provider: "xai",
      model: "grok-4.5",
      api: "responses",
    }),
  );

  assert.strictEqual(model.provider, "xai.responses");
});

test("direct xAI defaults to the chat model API", () => {
  const model = createLanguageModel(
    createConfig({ provider: "xai", model: "grok-4.5" }),
  );

  assert.strictEqual(model.provider, "xai.chat");
});
