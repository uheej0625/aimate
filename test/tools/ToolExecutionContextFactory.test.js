import test from "node:test";
import assert from "node:assert";
import { ToolExecutionContextFactory } from "../../src/tools/ToolExecutionContextFactory.js";

test("ToolExecutionContextFactory creates explicit tool dependencies", () => {
  const configManager = {
    get: (key) => (key === "character" ? "fixture" : null),
  };
  const cronJobScheduler = {};
  const imageGenerator = {};
  const generationRepository = {};
  const platformClient = {};
  const platformClients = new Map([["discord", platformClient]]);
  const requestCreatedAt = new Date("2026-08-01T15:21:03.000Z");
  const factory = new ToolExecutionContextFactory({
    configManager,
    cronJobScheduler,
    imageGenerator,
    generationRepository,
    platformClients,
  });

  const context = factory.create({
    platform: "discord",
    channel: { id: "channel-1" },
    requestCreatedAt,
  });

  assert.strictEqual(context.platformClient, platformClient);
  assert.strictEqual(context.cronJobScheduler, cronJobScheduler);
  assert.strictEqual(context.imageGenerator, imageGenerator);
  assert.strictEqual(context.generationRepository, generationRepository);
  assert.strictEqual(context.requestCreatedAt, requestCreatedAt);
  assert.strictEqual(context.characterId, "fixture");
  assert.ok(!Object.hasOwn(context, "ai"));
});
