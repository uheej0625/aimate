import test from "node:test";
import assert from "node:assert";
import { PostGenerationStateUpdater } from "../../src/services/PostGenerationStateUpdater.js";

test("PostGenerationStateUpdater applies channel-scoped emotion delta", async () => {
  let emotionCall = null;
  let relationshipCall = null;

  const emotionStateRepository = {
    applyDelta: async (...args) => {
      emotionCall = args;
    },
  };
  const userRepository = {
    applyRelationshipDelta: async (...args) => {
      relationshipCall = args;
    },
  };
  const updater = new PostGenerationStateUpdater(
    emotionStateRepository,
    userRepository,
  );

  await updater.apply({
    aiResult: {
      emotionDelta: { happiness: 3 },
      emotionReason: "test",
      relationshipDelta: { trust: 2 },
    },
    channelRecord: {
      id: "channel-1",
      scope: "channel",
    },
    currentUserId: "user-1",
  });

  assert.deepStrictEqual(emotionCall, [
    "channel:channel-1",
    "CHANNEL",
    { happiness: 3 },
    { channelId: "channel-1" },
  ]);
  assert.deepStrictEqual(relationshipCall, ["user-1", { trust: 2 }]);
});

test("PostGenerationStateUpdater applies server-scoped emotion delta", async () => {
  let emotionCall = null;
  const emotionStateRepository = {
    applyDelta: async (...args) => {
      emotionCall = args;
    },
  };
  const updater = new PostGenerationStateUpdater(emotionStateRepository);

  await updater.apply({
    aiResult: {
      emotionDelta: { sadness: -1 },
      emotionReason: "test",
      relationshipDelta: {},
    },
    channelRecord: {
      id: "channel-1",
      scope: "server",
      serverId: "server-1",
    },
    currentUserId: null,
  });

  assert.deepStrictEqual(emotionCall, [
    "server:server-1",
    "SERVER",
    { sadness: -1 },
    { serverId: "server-1" },
  ]);
});
