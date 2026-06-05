import test from "node:test";
import assert from "node:assert";
import { SequenceBuilder } from "../../../src/chat/context/SequenceBuilder.js";

test("SequenceBuilder tests", async (t) => {
  let lastRenderFileOptions = null;
  const mockPromptComposer = {
    renderFile: async (source, options) => {
      lastRenderFileOptions = options;
      const basename = source.replace(/\\/g, "/").split("/").pop();
      return `rendered:${basename}`;
    },
    render: async (template) =>
      template
        .replace("{{character.identity}}", "rendered:identity")
        .replace("{{runtime.platform}}", "rendered:platform"),
  };

  const builder = new SequenceBuilder(mockPromptComposer);

  await t.test("build should build sequence components correctly", async () => {
    const sequenceDef = [
      { type: "file", role: "system", source: "sys.md" },
      { type: "text", role: "user", content: "platform={{runtime.platform}}" },
      { type: "placeholder", role: "user", source: "character.identity" },
      { type: "cache-point" },
      { type: "file", role: "user", source: "p1.md" },
      { type: "history", slice: [-1] },
      { type: "pending" },
    ];

    const historyMessages = [
      { id: 1, authorPlatformId: "bot", content: "bot1" },
    ];
    const pendingMessages = [
      { id: 2, authorPlatformId: "user", content: "user1" },
    ];

    const { systemInstruction, context } = await builder.build(sequenceDef, {
      historyMessages,
      pendingMessages,
      botId: "bot",
      cronMessage: "cron-test",
      data: { memories: "memory-test" },
    });

    assert.strictEqual(systemInstruction, "rendered:sys.md");
    assert.strictEqual(lastRenderFileOptions.data.memories, "memory-test");
    // Context length: text(1) + placeholder(1) + p1.md(1) + history.slice(-1)(1) + cron(1) + pending(1) = 6
    assert.strictEqual(context.length, 6);
    assert.strictEqual(context[0].content, "platform=rendered:platform");
    assert.strictEqual(context[1].content, "rendered:identity");
    assert.strictEqual(context[2].content, "rendered:p1.md");
    assert.strictEqual(context[3].content, "bot1"); // history sliced
    assert.ok(context[4].content.includes("cron-test")); // cron
    assert.strictEqual(context[5].content, "user1"); // pending
  });
});
