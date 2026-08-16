import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptChannel,
  adaptIncomingMessage,
  adaptMessageData,
} from "../../../src/platforms/discord/adapter.js";

test("Discord adapter returns a platform-neutral incoming message", () => {
  const raw = createDiscordMessage();
  const request = adaptIncomingMessage(raw);

  assert.deepEqual(request.message, {
    platform: "discord",
    platformMessageId: "message-1",
    platformChannelId: "channel-1",
    platformServerId: "server-1",
    content: "hello",
    author: {
      platformUserId: "user-1",
      handle: "user",
      displayName: "User",
      isBot: false,
    },
  });
  assert.equal(request.botId, "bot-1");
  assert.equal(request.channel.platform, "discord");
  assert.equal(request.channel.platformChannelId, "channel-1");
  assert.equal("client" in request.message, false);
  assert.equal("channel" in request.message, false);
  assert.equal("guildId" in request.message, false);
});

test("Discord channel port sends and normalizes the returned message", async () => {
  let sentOptions = null;
  const rawChannel = {
    id: "channel-1",
    sendTyping: async () => {},
    send: async (options) => {
      sentOptions = options;
      return createDiscordMessage({
        id: "message-2",
        content: options.content,
        author: {
          id: "bot-1",
          username: "bot",
          globalName: "Bot",
          bot: true,
        },
      });
    },
  };
  const channel = adaptChannel(rawChannel);

  const sentMessage = await channel.send({ content: "reply" });

  assert.deepEqual(sentOptions, { content: "reply" });
  assert.deepEqual(sentMessage, {
    platform: "discord",
    platformMessageId: "message-2",
    platformChannelId: "channel-1",
    platformServerId: "server-1",
    content: "reply",
    author: {
      platformUserId: "bot-1",
      handle: "bot",
      displayName: "Bot",
      isBot: true,
    },
  });
});

test("adaptMessageData does not retain Discord runtime objects", () => {
  const message = adaptMessageData(createDiscordMessage());

  assert.equal("client" in message, false);
  assert.equal("channel" in message, false);
});

function createDiscordMessage(overrides = {}) {
  const channel =
    overrides.channel ??
    {
      id: "channel-1",
      send: async () => {},
      sendTyping: async () => {},
    };

  return {
    id: "message-1",
    channelId: "channel-1",
    guildId: "server-1",
    content: "hello",
    author: {
      id: "user-1",
      username: "user",
      globalName: "User",
      bot: false,
    },
    client: { user: { id: "bot-1" } },
    channel,
    ...overrides,
  };
}
