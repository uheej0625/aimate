import test from "node:test";
import assert from "node:assert";
import { ToolExecutionContextFactory } from "../../src/tools/ToolExecutionContextFactory.js";

test("ToolExecutionContextFactory creates explicit tool dependencies", () => {
  const configManager = {
    get: (key) => (key === "character" ? "fixture" : null),
  };
  const imageGenerator = {};
  const generationRepository = {};
  const messageActionService = {};
  const channelPort = {
    platform: "discord",
    platformChannelId: "platform-channel",
  };
  const delivery = { isCurrent: () => true };
  const platformClient = {};
  const platformClients = new Map([["discord", platformClient]]);
  const requestCreatedAt = new Date("2026-08-01T15:21:03.000Z");
  const factory = new ToolExecutionContextFactory({
    configManager,
    imageGenerator,
    generationRepository,
    messageActionService,
    platformClients,
  });

  const context = factory.create({
    platform: "discord",
    channel: { id: "channel-1" },
    requestCreatedAt,
    channelPort,
    generationId: 42,
    delivery,
  });

  assert.strictEqual(context.platformClient, platformClient);
  assert.strictEqual(context.imageGenerator, imageGenerator);
  assert.strictEqual(context.generationRepository, generationRepository);
  assert.strictEqual(context.messageActionService, messageActionService);
  assert.strictEqual(context.channelPort, channelPort);
  assert.strictEqual(context.generationId, 42);
  assert.strictEqual(context.delivery, delivery);
  assert.strictEqual(context.requestCreatedAt, requestCreatedAt);
  assert.strictEqual(context.characterId, "fixture");
  assert.ok(!Object.hasOwn(context, "ai"));
});
