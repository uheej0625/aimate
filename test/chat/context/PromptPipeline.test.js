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
  assert.match(result.context[1].content, /## messages/);
  assert.strictEqual(result.context[2].content, "hello");
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

test("character config controls current time, age and grade", async (t) => {
  const cases = [
    {
      name: "character config overrides app timezone at the birthday boundary",
      appTimezone: "UTC",
      date: "2025-12-31T16:00:00Z",
      expectedTime: "2026-01-01T01:00:00+09:00",
      age: 26,
      grade: 2,
    },
    {
      name: "character config overrides app timezone at the academic year boundary",
      appTimezone: "UTC",
      date: "2026-02-28T16:00:00Z",
      expectedTime: "2026-03-01T01:00:00+09:00",
      age: 26,
      grade: 3,
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const characterBuilder = new CharacterContextBuilder({
        identityPath: "test/fixtures/character/identity.md",
        variablesPath: "test/fixtures/character/variables.json",
        configPath: scenario.configPath,
      });
      const composer = new PromptComposer(
        { getAll: () => ({ app: { timezone: scenario.appTimezone } }) },
        characterBuilder,
      );
      const context = await composer.buildContext({
        referenceDate: new Date(scenario.date),
      });

      assert.equal(context.system.now.raw, scenario.expectedTime);
      assert.equal(context.character.age, scenario.age);
      assert.equal(context.character.schoolGrade, scenario.grade);
      assert.match(context.character.identity, new RegExp(`Age: ${scenario.age}`));
      assert.equal(context.character.timezone, undefined);
    });
  }
});

test("character config is required", async () => {
  const builder = new CharacterContextBuilder({
    identityPath: "test/fixtures/character/identity.md",
    variablesPath: "test/fixtures/character/variables.json",
    configPath: "test/fixtures/character/missing-config.json",
  });

  await assert.rejects(
    () => builder.loadConfig(),
    /Missing required character configuration/,
  );
});

test("character identity is required", async () => {
  const builder = new CharacterContextBuilder({
    identityPath: "test/fixtures/character/missing.md",
    variablesPath: "test/fixtures/character/variables.json",
  });

  await assert.rejects(() => builder.build(), /missing\.md/);
});
