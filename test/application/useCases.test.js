import test from "node:test";
import assert from "node:assert";
import { ActivateChannel } from "../../src/application/ActivateChannel.js";
import { StoredMessageService } from "../../src/application/StoredMessageService.js";
import { GetGenerationInfo } from "../../src/application/GetGenerationInfo.js";
import { RerollConversation } from "../../src/application/RerollConversation.js";
import { ConversationSession } from "../../src/chat/ConversationSession.js";
import { ChannelCatalog } from "../../src/application/ChannelCatalog.js";

test("ActivateChannel resolves a server and activates its channel", async () => {
  const serverCalls = [];
  const channelCalls = [];
  const useCase = new ActivateChannel(
    {
      upsert: async (data) => {
        channelCalls.push(data);
        return { id: "channel" };
      },
    },
    {
      upsert: async (data) => {
        serverCalls.push(data);
        return { id: "server" };
      },
    },
  );

  await useCase.execute({
    platform: "discord",
    platformChannelId: "channel-1",
    platformServerId: "server-1",
    scope: "channel",
  });

  assert.deepStrictEqual(serverCalls, [
    { platform: "discord", platformId: "server-1" },
  ]);
  assert.deepStrictEqual(channelCalls, [
    {
      platform: "discord",
      platformId: "channel-1",
      serverId: "server",
      scope: "channel",
    },
  ]);
});

test("StoredMessageService uses the common event handler for confirmed deletions", async () => {
  const calls = [];
  const service = new StoredMessageService({
    handle: async (event) => {
      calls.push(event);
      return { deletedCount: event.platformMessageIds.length };
    },
  });
  const channel = { platform: "discord", platformChannelId: "channel" };
  assert.equal(
    await service.deleteOne({ platformMessageId: "m1", channel, botId: "bot" }),
    true,
  );
  assert.equal(
    await service.deleteMany({
      platformMessageIds: ["m2", "m3"],
      channel,
      botId: "bot",
    }),
    2,
  );
  assert.deepEqual(calls, [
    { kind: "DELETE", platformMessageIds: ["m1"], channel, botId: "bot" },
    { kind: "DELETE", platformMessageIds: ["m2", "m3"], channel, botId: "bot" },
  ]);
});

test("GetGenerationInfo returns a parsed generation DTO", async () => {
  const createdAt = new Date("2026-08-09T00:00:00Z");
  const updatedAt = new Date("2026-08-09T00:01:00Z");
  const useCase = new GetGenerationInfo({
    findByPlatformId: async () => ({
      generation: {
        id: 7,
        type: "CHAT",
        status: "COMPLETED",
        input: JSON.stringify({
          messages: [{ id: 1, content: "hello" }],
        }),
        output: JSON.stringify(["hi"]),
        createdAt,
        updatedAt,
      },
    }),
  });

  const result = await useCase.execute({
    platform: "discord",
    platformMessageId: "message-1",
  });

  assert.deepStrictEqual(result, {
    generation: {
      id: 7,
      type: "CHAT",
      status: "COMPLETED",
      inputMessages: [{ id: 1, content: "hello" }],
      outputMessages: ["hi"],
      createdAt,
      updatedAt,
    },
  });
});

test("RerollConversation prepares cleanup and reruns the conversation", async () => {
  const deleted = [];
  const requests = [];
  const useCase = new RerollConversation(
    {
      findByPlatformId: async () => ({
        generationId: 7,
        isBot: true,
        generation: { channelId: "internal-channel-1", input: "{}" },
      }),
      findByGenerationId: async () => [
        { platformId: "reply-1", isBot: true },
        { platformId: "reply-2", isBot: true },
        { platformId: "user-input", isBot: false },
      ],
    },
    {
      deleteMessages: async (...args) => {
        deleted.push(args);
        return { deletedCount: 2 };
      },
    },
    {
      execute: async (request) => requests.push(request),
    },
    { discard: async (id) => assert.equal(id, 7) },
    new ConversationSession(),
  );

  const plan = await useCase.prepare({
    platform: "discord",
    platformMessageId: "reply-1",
  });
  assert.deepStrictEqual(plan, {
    status: "READY",
    generationId: 7,
    internalChannelId: "internal-channel-1",
    platformMessageIds: ["reply-1", "reply-2"],
  });

  const conversationRequest = {
    channelPort: { platform: "discord", platformChannelId: "channel-1" },
    internalChannelId: plan.internalChannelId,
    botId: "bot",
  };
  const result = await useCase.execute({
    platform: "discord",
    platformMessageIds: plan.platformMessageIds,
    generationId: 7,
    conversationRequest,
  });

  assert.deepStrictEqual(result, { deletedCount: 2 });
  assert.deepStrictEqual(deleted, [
    [
      "discord",
      ["reply-1", "reply-2"],
      "internal-channel-1",
      { observed: false },
    ],
  ]);
  assert.deepStrictEqual(requests, [
    { ...conversationRequest, rerollGenerationId: 7 },
  ]);
});

test("ChannelCatalog maps repository records to channel DTOs", async () => {
  const updatedAt = new Date("2026-08-09T00:00:00Z");
  const catalog = new ChannelCatalog(
    {
      listByPlatform: async () => [
        {
          platformId: "channel-1",
          updatedAt,
          _count: { messages: 1 },
        },
      ],
    },
    {
      getHistoryByPlatformChannelId: async () => [
        {
          platformId: "message-1",
          author: { platformId: "user-1" },
          content: "hello",
          createdAt: updatedAt,
        },
      ],
    },
  );

  assert.deepStrictEqual(await catalog.list({ platform: "cli" }), [
    {
      id: "channel-1",
      messageCount: 1,
      updatedAt,
      messages: [
        {
          id: "message-1",
          authorPlatformId: "user-1",
          content: "hello",
          createdAt: updatedAt,
        },
      ],
    },
  ]);
});
