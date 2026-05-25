import test from "node:test";
import assert from "node:assert";
import { ToolCallingChatRunner } from "../../src/services/ToolCallingChatRunner.js";

test("ToolCallingChatRunner runs tool loop and preserves generated image tags", async () => {
  let callCount = 0;
  let toolContext = null;
  const configManager = {
    get: (key) => {
      if (key === "ai.chat.stream") return false;
      if (key === "tools.maxSteps") return 5;
      return null;
    },
  };
  const chatModel = {
    generateChat: async function* () {
      callCount += 1;
      if (callCount === 1) {
        yield {
          type: "tool_call",
          id: "call-1",
          name: "generate_photo",
          args: { scene: "room" },
        };
        return;
      }

      yield {
        type: "text",
        content: "## messages\n완료\n## emotion_delta\nattachment: 0",
      };
    },
  };
  const toolRegistry = {
    getActiveTools: () => [{ declaration: { name: "generate_photo" } }],
  };
  const toolExecutor = {
    executeAll: async (toolCalls, platform, channelRecord, aiService) => {
      toolContext = { toolCalls, platform, channelRecord, aiService };
      return [
        {
          imageId: "9a9d426d",
          instruction: "Include [IMAGE:9a9d426d].",
        },
      ];
    },
  };
  const aiService = { generateImage: async () => ({}) };
  const runner = new ToolCallingChatRunner(configManager);

  const result = await runner.run({
    chatModel,
    context: ["user message"],
    systemInstruction: "system",
    platform: "discord",
    channelRecord: { id: "channel-1" },
    toolRegistry,
    toolExecutor,
    aiService,
  });

  assert.strictEqual(callCount, 2);
  assert.strictEqual(toolContext.platform, "discord");
  assert.strictEqual(toolContext.aiService, aiService);
  assert.match(result.messages[0], /\[IMAGE:9a9d426d\]/);
  assert.deepStrictEqual(result.emotionDelta, { attachment: 0 });
});

test("ToolCallingChatRunner returns ellipsis for empty context", async () => {
  const runner = new ToolCallingChatRunner({ get: () => null });
  const result = await runner.run({
    chatModel: {},
    context: [],
    systemInstruction: "system",
  });

  assert.deepStrictEqual(result.messages, ["..."]);
});
