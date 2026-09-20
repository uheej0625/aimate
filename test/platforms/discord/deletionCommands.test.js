import test from "node:test";
import assert from "node:assert/strict";
import deleteAfter from "../../../src/platforms/discord/commands/deleteAfter.js";
import reroll from "../../../src/platforms/discord/commands/reroll.js";

function interaction(channel) {
  return {
    channel,
    channelId: channel.id,
    client: { user: { id: "bot" }, channels: { fetch: async () => channel } },
    deferReply: async () => {},
    editReply: async () => {},
  };
}

test("delete command forwards only confirmed platform deletions to the common handler", async () => {
  const target = { id: "ok", delete: async () => {} };
  const denied = {
    id: "denied",
    delete: async () => {
      throw Object.assign(new Error("no permission"), { code: 50013 });
    },
  };
  const found = new Map([[denied.id, denied]]);
  found.last = () => denied;
  const channel = { id: "channel", messages: { fetch: async () => found } };
  let received;
  await deleteAfter.execute(
    { ...interaction(channel), targetMessage: target },
    {
      storedMessageService: {
        deleteMany: async (request) => {
          received = request;
          return 1;
        },
      },
    },
  );
  assert.deepEqual(received.platformMessageIds, ["ok"]);
  assert.equal(received.channel.platformChannelId, "channel");
  assert.equal(received.botId, "bot");
});

test("reroll preserves failed platform deletions and passes the original generation", async () => {
  const channel = {
    id: "channel",
    messages: {
      fetch: async (id) => ({
        delete: async () => {
          if (id === "denied")
            throw Object.assign(new Error("no permission"), { code: 50013 });
        },
      }),
    },
  };
  let received;
  await reroll.execute(
    { ...interaction(channel), targetMessage: { id: "ok" } },
    {
      rerollConversation: {
        prepare: async () => ({
          status: "READY",
          generationId: 7,
          internalChannelId: "internal",
          platformMessageIds: ["ok", "denied"],
        }),
        execute: async (request) => {
          received = request;
          return { deletedCount: 1 };
        },
      },
    },
  );
  assert.deepEqual(received.platformMessageIds, ["ok"]);
  assert.equal(received.generationId, 7);
});
