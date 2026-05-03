import test from "node:test";
import assert from "node:assert";
import { SequenceBuilder } from "../../src/services/SequenceBuilder.js";

test("SequenceBuilder tests", async (t) => {
  const mockPromptComposer = {
    renderFile: async (source) => {
      const basename = source.replace(/\\/g, "/").split("/").pop();
      return `rendered:${basename}`;
    },
  };

  const builder = new SequenceBuilder(mockPromptComposer);

  await t.test("build should build sequence components correctly", async () => {
    const sequenceDef = [
      { type: "file", role: "system", source: "sys.md" },
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
    });

    assert.strictEqual(systemInstruction, "rendered:sys.md");
    // Context length: p1.md(1) + history.slice(-1)(1) + cron(1) + pending(1) = 4
    assert.strictEqual(context.length, 4);
    assert.strictEqual(context[0].content, "rendered:p1.md");
    assert.strictEqual(context[1].content, "bot1"); // history sliced
    assert.ok(context[2].content.includes("cron-test")); // cron
    assert.strictEqual(context[3].content, "user1"); // pending
  });
});
