import test from "node:test";
import assert from "node:assert";
import { AIService } from "../../src/services/AIService.js";

test("AIService tests", async (t) => {
  const mockConfigManager = {
    get: (key) => {
      if (key === "ai.chat") return { provider: "googleCloud", stream: false };
      if (key === "ai.image") return { provider: "googleCloud", stream: false };
      if (key === "ai.chat.stream") return false;
      return null;
    },
  };

  const mockHistoryService = {
    fetchHistoryData: async () => ({
      history: [],
      messageIds: [],
      lastUserPlatformAccountId: "user-1",
    }),
  };

  const mockPromptComposer = {
    build: async (template) => `built-${template}`,
    buildFromFile: async (file) => `built-file-${file}`,
  };

  const mockUserRepository = {
    findByPlatformAccountId: async () => ({ id: "u123", name: "User" }),
  };

  // Note: AIService calls createModel in constructor.
  // For testing, we can override the prototype or just accept it will try to create a provider.
  // Since we don't want to hit real APIs, we'll mock the provider after instantiation.

  const aiService = new AIService(
    mockHistoryService,
    mockConfigManager,
    null,
    null,
    mockPromptComposer,
    mockUserRepository,
    {
      loadSequence: async () => [],
      build: async () => ({
        context: ["assembled-context"],
        systemInstruction: "built-sys-template",
      }),
    },
  );

  await t.test(
    "_parseAIResponse should parse markdown format correctly",
    () => {
      const text = `
## messages
Hello! [BREAK] How are you?
## emotion_delta
happiness: 5
## emotion_reason
Greeting
## relationship_delta
friendship: 2
`;
      const result = aiService._parseAIResponse(text);
      assert.deepStrictEqual(result.messages, ["Hello!", "How are you?"]);
      assert.strictEqual(result.emotionDelta.happiness, 5);
      assert.strictEqual(result.emotionReason, "Greeting");
      assert.strictEqual(result.relationshipDelta.friendship, 2);
    },
  );

  await t.test("prepareContext should coordinate services", async () => {
    const result = await aiService.prepareContext("chan-1", "bot-1");

    assert.ok(result.context.includes("assembled-context"));
    assert.strictEqual(result.systemInstruction, "built-sys-template");
    assert.strictEqual(result.currentUserId, "u123");
  });

  await t.test(
    "generateChat should preserve generated image tags when model omits them",
    async () => {
      let callCount = 0;
      aiService.chatModel = {
        generateChat: async function* () {
          callCount += 1;
          if (callCount === 1) {
            yield {
              type: "tool_call",
              name: "generate_selfie",
              args: { scene: "room" },
            };
            return;
          }

          yield {
            type: "text",
            content:
              "## messages\n이거면 됐나\n## emotion_delta\nattachment: 0",
          };
        },
      };
      aiService.toolRegistry = {
        getActiveTools: () => [{ declaration: { name: "generate_selfie" } }],
      };
      aiService.toolExecutor = {
        executeAll: async () => [
          {
            status: "success",
            imageId: "9a9d426d",
            instruction:
              "Image generated successfully! Include [IMAGE:9a9d426d].",
          },
        ],
      };

      const result = await aiService.generateChat(
        ["user message"],
        "system",
        "discord",
      );

      assert.strictEqual(result.messages.length, 1);
      assert.match(result.messages[0], /\[IMAGE:9a9d426d\]/);
    },
  );
});
