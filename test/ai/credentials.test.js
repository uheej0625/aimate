import test from "node:test";
import assert from "node:assert/strict";
import { loadAiCredentials } from "../../src/ai/credentials.js";

test("credentials load only known authentication variables into a frozen snapshot", () => {
  const env = {
    OPENAI_API_KEY: "openai-test",
    GOOGLE_GENERATIVE_AI_API_KEY: "google-test",
    AI_GATEWAY_API_KEY: "gateway-test",
    VERCEL_OIDC_TOKEN: "oidc-test",
    OPENAI_COMPATIBLE_API_KEY: "compatible-test",
    XAI_API_KEY: "xai-test",
    VERTEX_CLIENT_EMAIL: "test@example.invalid",
    VERTEX_PRIVATE_KEY: "test-private-key",
    VERTEX_PROJECT_ID: "ordinary-setting",
    DATABASE_URL: "unrelated-secret",
  };
  const credentials = loadAiCredentials(env);
  assert.deepEqual(credentials, {
    openaiApiKey: "openai-test",
    googleApiKey: "google-test",
    aiGatewayApiKey: "gateway-test",
    openaiCompatibleApiKey: "compatible-test",
    xaiApiKey: "xai-test",
    vertexClientEmail: "test@example.invalid",
    vertexPrivateKey: "test-private-key",
  });
  env.OPENAI_API_KEY = "changed";
  assert.equal(credentials.openaiApiKey, "openai-test");
  assert.ok(Object.isFrozen(credentials));
});

test("Gateway authentication prefers an API key and falls back to OIDC", () => {
  assert.equal(
    loadAiCredentials({ VERCEL_OIDC_TOKEN: "oidc-test" }).aiGatewayApiKey,
    "oidc-test",
  );
  assert.equal(
    loadAiCredentials({
      AI_GATEWAY_API_KEY: "",
      VERCEL_OIDC_TOKEN: "oidc-test",
    }).aiGatewayApiKey,
    "oidc-test",
  );
  assert.ok(
    Object.values(loadAiCredentials({})).every((value) => value === undefined),
  );
});
