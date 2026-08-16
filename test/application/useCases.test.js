import test from "node:test";
import assert from "node:assert";
import { ActivateChannel } from "../../src/application/ActivateChannel.js";
import { StoredMessageService } from "../../src/application/StoredMessageService.js";
import { GetGenerationInfo } from "../../src/application/GetGenerationInfo.js";
import { RerollConversation } from "../../src/application/RerollConversation.js";
import { ConversationCatalog } from "../../src/application/ConversationCatalog.js";

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

test("StoredMessageService delegates platform-neutral deletion requests", async () => {
  const calls = [];
  const service = new StoredMessageService({
    deleteByPlatformId: async (...args) => {
      calls.push(["one", ...args]);
      return true;
    },
    deleteManyByPlatformIds: async (...args) => {
      calls.push(["many", ...args]);
      return 2;
    },
  });

  assert.strictEqual(
    await service.deleteOne({
      platform: "discord",
      platformMessageId: "message-1",
    }),
    true,
  );
  assert.strictEqual(
    await service.deleteMany({
      platform: "discord",
      platformMessageIds: ["message-1", "message-2"],
    }),
    2,
  );
  assert.deepStrictEqual(calls, [
    ["one", "discord", "message-1"],
    ["many", "discord", ["message-1", "message-2"]],
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
      findByPlatformId: async () => ({ generationId: 7 }),
      findByGenerationId: async () => [
        { platformId: "reply-1" },
        { platformId: "reply-2" },
      ],
      deleteManyByPlatformIds: async (...args) => {
        deleted.push(args);
        return 2;
      },
    },
    {
      execute: async (request) => requests.push(request),
    },
  );

  const plan = await useCase.prepare({
    platform: "discord",
    platformMessageId: "reply-1",
  });
  assert.deepStrictEqual(plan, {
    status: "READY",
    generationId: 7,
    platformMessageIds: ["reply-1", "reply-2"],
  });

  const conversationRequest = {
    channel: { platform: "discord", platformChannelId: "channel-1" },
    botId: "bot",
  };
  const result = await useCase.execute({
    platform: "discord",
    platformMessageIds: plan.platformMessageIds,
    conversationRequest,
  });

  assert.deepStrictEqual(result, { deletedCount: 2 });
  assert.deepStrictEqual(deleted, [
    ["discord", ["reply-1", "reply-2"]],
  ]);
  assert.deepStrictEqual(requests, [conversationRequest]);
});

test("ConversationCatalog maps repository records to conversation DTOs", async () => {
  const updatedAt = new Date("2026-08-09T00:00:00Z");
  const catalog = new ConversationCatalog(
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
