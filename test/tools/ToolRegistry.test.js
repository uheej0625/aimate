import test from "node:test";
import assert from "node:assert";
import { jsonSchema } from "ai";
import { ToolRegistry } from "../../src/tools/ToolRegistry.js";

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
    ai: { id: "runtime" },
  });

  assert.ok(toolSet.echo);
  const output = await toolSet.echo.execute(
    { value: "hi" },
    { toolCallId: "call-1", messages: [] },
  );

  assert.deepStrictEqual(output, { value: "hi", platform: "cli" });
  assert.strictEqual(received.context.toolCallId, "call-1");
  assert.strictEqual(received.context.ai.id, "runtime");
});
