import test from "node:test";
import assert from "node:assert";
import { AISDKProvider } from "../../src/providers/AISDKProvider.js";

function createConfigManager(config) {
  return {
    get: (key) => key.split(".").reduce((obj, part) => obj?.[part], config),
  };
}

test("AISDKProvider converts internal chat context to AI SDK messages", () => {
  const provider = new AISDKProvider(
    createConfigManager({
      ai: {
        chat: {
          provider: "aiSdk",
          model: "openai/gpt-5-mini",
          aiSdk: { provider: "gateway" },
        },
      },
      secrets: { aiGatewayApiKey: "gateway-key" },
    }),
    "chat",
  );

  const messages = provider._buildMessages([
    { role: "user", content: "몇 시야?" },
    {
      role: "tool_result",
      calls: [
        {
          id: "call-1",
          name: "get_current_time",
          args: {},
          result: { local: "2026. 5. 24. 오후 11:00:00" },
        },
      ],
    },
  ]);

  assert.deepStrictEqual(messages, [
    { role: "user", content: "몇 시야?" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "get_current_time",
          input: {},
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "get_current_time",
          output: { local: "2026. 5. 24. 오후 11:00:00" },
        },
      ],
    },
  ]);
});

test("AISDKProvider converts function declarations to AI SDK tools", () => {
  const provider = new AISDKProvider(
    createConfigManager({
      ai: {
        chat: {
          provider: "aiSdk",
          model: "openai/gpt-5-mini",
          aiSdk: { provider: "gateway" },
        },
      },
      secrets: { aiGatewayApiKey: "gateway-key" },
    }),
    "chat",
  );

  const tools = provider._buildTools([
    {
      name: "get_current_time",
      description: "현재 시각",
      parameters: { type: "object", properties: {}, required: [] },
    },
  ]);

  assert.ok(tools.get_current_time);
  assert.strictEqual(tools.get_current_time.description, "현재 시각");
  assert.ok(tools.get_current_time.inputSchema);
});
