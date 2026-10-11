import test from "node:test";
import assert from "node:assert";
import { jsonSchema } from "ai";
import { ToolRegistry } from "../../src/tools/ToolRegistry.js";
import reply from "../../src/tools/definitions/reply.js";
import react from "../../src/tools/definitions/react.js";

test("ToolRegistry creates AI SDK toolsets with runtime context", async () => {
  let received = null;
  const registry = new ToolRegistry({
    get: (key) => (key === "ai.image.model" ? "openai/gpt-image-1" : null),
    has: () => false,
  });

  registry.register({
    name: "echo",
    enabled: true,
    platforms: ["cli"],
    requires: [],
    description: "Echo input",
    inputSchema: jsonSchema({
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    }),
    execute: async (input, context) => {
      received = { input, context };
      return { value: input.value, platform: context.platform };
    },
  });

  const toolSet = registry.createToolSet("cli", {
    platform: "cli",
    imageGenerator: { id: "image-generator" },
    abortSignal: new AbortController().signal,
  });

  assert.ok(toolSet.echo);
  const output = await toolSet.echo.execute(
    { value: "hi" },
    { toolCallId: "call-1", messages: [] },
  );

  assert.deepStrictEqual(output, { value: "hi", platform: "cli" });
  assert.strictEqual(received.context.toolCallId, "call-1");
  assert.strictEqual(received.context.imageGenerator.id, "image-generator");
  assert.ok(received.context.abortSignal);
  assert.ok(!Object.hasOwn(received.context, "ai"));
});

test("message action definitions are exposed only on Discord", async () => {
  const registry = new ToolRegistry({ has: () => false });
  registry.registerAll([reply, react]);
  assert.deepStrictEqual(registry.getActiveTools("cli"), []);
  const received = [];
  const tools = registry.createToolSet("discord", {
    messageActionService: {
      reply: async (input) => {
        received.push(input);
        return { success: true };
      },
      react: async (input) => {
        received.push(input);
        return { success: true };
      },
    },
  });
  await tools.reply.execute({ targetMessageNo: 11, text: "hello" });
  await tools.react.execute({ targetMessageNo: 11, emoji: "😴" });
  assert.deepStrictEqual(received, [
    { targetMessageNo: 11, text: "hello" },
    { targetMessageNo: 11, emoji: "😴" },
  ]);
});
