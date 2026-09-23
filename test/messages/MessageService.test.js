import test from "node:test";
import assert from "node:assert";
const observedAt = new Date("2026-09-20T00:00:00Z");

import { MessageService } from "../../src/messages/MessageService.js";

function createService({ messageRepository = {}, eventRepository = {} } = {}) {
  const events = [];
  const defaults = {
    transaction: async (callback) => await callback({}),
    findByPlatformIdInTransaction: async () => null,
    upsertInTransaction: async (_tx, data) => ({ id: 1, ...data }),
    updateContentInTransaction: async (_tx, id, content) => ({ id, content }),
    findActiveByPlatformIdsInTransaction: async () => [],
    findActiveByChannelInTransaction: async () => [],
    softDeleteByIdsInTransaction: async (_tx, ids) => ids.length,
  };
  const eventDefaults = {
    findLatestForMessage: async () => null,
    create: async (_tx, data) => {
      events.push(data);
      return data;
    },
  };

  return {
    events,
    service: new MessageService(
      { create: async () => ({ id: "user-123" }) },
      {
        findByPlatformId: async () => null,
        upsert: async (data) => ({ id: "account-123", ...data }),
      },
      { upsert: async (data) => ({ id: "channel-123", ...data }) },
      { upsert: async (data) => ({ id: "server-123", ...data }) },
      { ...defaults, ...messageRepository },
      { ...eventDefaults, ...eventRepository },
      { get: (key) => (key === "character" ? "fixture" : undefined) },
    ),
  };
}

function normalizedMessage(overrides = {}) {
  return {
    platform: "discord",
    platformMessageId: "message-1",
    platformChannelId: "channel-1",
    platformServerId: "server-1",
    author: {
      platformUserId: "author-1",
      handle: "user",
      displayName: "User",
      isBot: false,
    },
    content: "Hello",
    ...overrides,
  };
}

test("MessageService saves a message and records its observed state", async () => {
  let savedData;
  const { service, events } = createService({
    messageRepository: {
      upsertInTransaction: async (_tx, data) => {
        savedData = data;
        return { id: 1, ...data };
      },
    },
  });

  const result = await service.saveMessage(
    normalizedMessage(),
    "generation-1",
    [{ name: "note.txt" }],
    { observedAt },
  );

  assert.strictEqual(result.message.content, "Hello");
  assert.strictEqual(result.channel.id, "channel-123");
  assert.strictEqual(result.platformAccount.id, "account-123");
  assert.strictEqual(result.changed, true);
  assert.strictEqual(savedData.generationId, "generation-1");
  assert.deepStrictEqual(events, [
    {
      characterId: "fixture",
      channelId: "channel-123",
      messageId: 1,
      platform: "discord",
      platformMessageId: "message-1",
      kind: "READ",
      editedAt: null,
      observedAt,
      snapshotContent: "Hello",
      snapshotAttachmentsJson: JSON.stringify([{ name: "note.txt" }]),
      generationId: null,
    },
  ]);
});

test("MessageService stores the current state of a first-seen edit without inventing an observation", async () => {
  const { service, events } = createService();

  const result = await service.updateMessage(
    normalizedMessage({ platformMessageId: "missing", content: "edited" }),
  );

  assert.equal(result.changed, true);
  assert.equal(result.message.content, "edited");
  assert.deepStrictEqual(events, []);
});

test("MessageService records an update with the post-update snapshot", async () => {
  const existing = {
    id: 1,
    channelId: "channel-123",
    platform: "discord",
    platformId: "message-1",
    editedAt: null,
    content: "before",
    attachmentsJson: "[]",
    generationId: "generation-1",
  };
  const { service, events } = createService({
    messageRepository: {
      findByPlatformIdInTransaction: async () => existing,
      updateContentInTransaction: async (_tx, id, content) => ({
        ...existing,
        id,
        content,
      }),
    },
    eventRepository: {
      findLatestForMessage: async () => ({ generationId: "generation-1" }),
    },
  });

  const result = await service.updateMessage(
    normalizedMessage({ content: "after" }),
    { observed: true, observedAt },
  );

  assert.strictEqual(result.changed, true);
  assert.deepStrictEqual(events, [
    {
      characterId: "fixture",
      channelId: "channel-123",
      messageId: 1,
      platform: "discord",
      platformMessageId: "message-1",
      kind: "EDIT",
      previousContent: null,
      editedAt: null,
      observedAt,
      snapshotContent: "after",
      snapshotAttachmentsJson: "[]",
      generationId: "generation-1",
    },
  ]);
});

test("MessageService soft deletes rows after recording delete events", async () => {
  const messages = [
    {
      id: 1,
      channelId: "channel-123",
      platform: "discord",
      platformId: "one",
      content: "first",
      attachmentsJson: null,
    },
    {
      id: 2,
      channelId: "channel-123",
      platform: "discord",
      platformId: "two",
      content: "second",
      attachmentsJson: "[]",
    },
  ];
  let deletedIds;
  const { service, events } = createService({
    messageRepository: {
      findActiveByPlatformIdsInTransaction: async () => messages,
      softDeleteByIdsInTransaction: async (_tx, ids) => {
        deletedIds = ids;
        return ids.length;
      },
    },
  });

  const result = await service.deleteMessages("discord", ["one", "two"], null, {
    observed: true,
    observedAt,
  });

  assert.deepStrictEqual(result, {
    deletedCount: 2,
    deletedMessages: messages,
  });
  assert.deepStrictEqual(deletedIds, [1, 2]);
  assert.deepStrictEqual(
    events.map((event) => [event.kind, event.snapshotContent]),
    [
      ["DELETE", null],
      ["DELETE", null],
    ],
  );
});
