import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptIncomingMessage,
  adaptMessageData,
} from "../../../src/platforms/cli/adapter.js";

test("CLI adapter matches the platform-neutral message contract", () => {
  const channel = {
    platform: "cli",
    platformChannelId: "channel-1",
    send: async () => {},
    sendTyping: async () => {},
  };
  const raw = {
    id: "message-1",
    channelId: "channel-1",
    guildId: null,
    content: "hello",
    author: {
      id: "user-1",
      username: "user",
      globalName: "User",
      bot: false,
    },
    channel,
    client: { user: { id: "bot-1" } },
  };

  const request = adaptIncomingMessage(raw);

  assert.deepEqual(request.message, {
    platform: "cli",
    platformMessageId: "message-1",
    platformChannelId: "channel-1",
    platformServerId: null,
    content: "hello",
    author: {
      platformUserId: "user-1",
      handle: "user",
      displayName: "User",
      isBot: false,
    },
  });
  assert.strictEqual(request.channel, channel);
  assert.equal(request.botId, "bot-1");
});

test("CLI message data does not retain CLI runtime objects", () => {
  const message = adaptMessageData({
    id: "message-1",
    channelId: "channel-1",
    content: "hello",
    author: {
      id: "user-1",
      username: "user",
    },
    channel: {},
    client: {},
  });

  assert.equal("client" in message, false);
  assert.equal("channel" in message, false);
  assert.equal(message.author.isBot, false);
});
