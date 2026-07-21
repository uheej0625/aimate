import test from "node:test";
import assert from "node:assert";
import { CharacterContextBuilder } from "../../../src/character/CharacterContextBuilder.js";
import { PromptComposer } from "../../../src/chat/context/PromptComposer.js";
import { SequenceBuilder } from "../../../src/chat/context/SequenceBuilder.js";

test("prompt pipeline loads and renders a complete prompt fixture", async () => {
  const characterBuilder = new CharacterContextBuilder({
    identityPath: "test/fixtures/character/identity.md",
    variablesPath: "test/fixtures/character/variables.json",
  });
  const configManager = {
    getAll: () => ({ app: { language: "ko-KR" } }),
  };
  const composer = new PromptComposer(configManager, characterBuilder);
  const builder = new SequenceBuilder(composer, {
    promptsRoot: "test/fixtures/prompts",
  });
  const sequence = await builder.loadSequence("minimal");

  const result = await builder.build(sequence, {
    promptName: "minimal",
    historyMessages: [],
    pendingMessages: [{ content: "hello" }],
    botId: "bot",
  });

  assert.match(result.systemInstruction, /Fixture Character/);
  assert.match(result.context[0].content, /Name: Fixture Character/);
  assert.strictEqual(result.context[1].content, "hello");
  assert.match(result.context[2].content, /## messages/);
});

test("prompt pipeline rejects a missing prompt pack", async () => {
  const builder = new SequenceBuilder(
    {},
    {
      promptsRoot: "test/fixtures/prompts",
    },
  );

  await assert.rejects(() => builder.loadSequence("missing"), /sequence\.js/);
});

test("character identity is required", async () => {
  const builder = new CharacterContextBuilder({
    identityPath: "test/fixtures/character/missing.md",
    variablesPath: "test/fixtures/character/variables.json",
  });

  await assert.rejects(() => builder.build(), /missing\.md/);
});
