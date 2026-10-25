import test from "node:test";
import assert from "node:assert";
import { jsonSchema } from "ai";
import { ToolRegistry } from "../../src/tools/ToolRegistry.js";
import reply from "../../src/tools/definitions/reply.js";
import react from "../../src/tools/definitions/react.js";
import { captureLogs } from "../helpers/logs.js";

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

test("tool logs classify returned errors and aborts without logging payloads", async (t) => {
  const records = captureLogs(t);
  const registry = new ToolRegistry({ has: () => false });
  for (const [name, execute] of Object.entries({
    ok: async () => ({ content: "PRIVATE_RESULT" }),
    returned_error: async () => ({ error: "PRIVATE_RETURNED_ERROR" }),
    thrown_error: async () => {
      throw Object.assign(new Error("tool failed"), {
        responseBody: "PRIVATE_BODY",
      });
    },
    cancelled: async () => {
      throw new DOMException("Aborted", "AbortError");
    },
  })) {
    registry.register({
      name,
      description: name,
      inputSchema: jsonSchema({ type: "object" }),
      execute,
    });
  }
  const tools = registry.createToolSet("discord", {
    generationId: "gen-1",
    channel: { id: "channel-1" },
  });
  for (const name of Object.keys(tools))
    await tools[name].execute(
      { prompt: "PRIVATE_INPUT" },
      { toolCallId: name },
    );
  const terminal = records.filter((row) =>
    ["tool.completed", "tool.failed", "tool.cancelled"].includes(row.event),
  );
  assert.deepStrictEqual(
    terminal.map((row) => [row.toolName, row.event, row.level]),
    [
      ["ok", "tool.completed", 30],
      ["returned_error", "tool.failed", 40],
      ["thrown_error", "tool.failed", 50],
      ["cancelled", "tool.cancelled", 20],
    ],
  );
  assert.ok(
    terminal.every(
      (row) =>
        row.generationId === "gen-1" &&
        row.channelId === "channel-1" &&
        row.toolCallId === row.toolName &&
        row.durationMs >= 0,
    ),
  );
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_/);
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
