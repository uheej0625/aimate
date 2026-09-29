import test from "node:test";
import assert from "node:assert/strict";
import { HistoryService } from "../../src/messages/HistoryService.js";

function event(id, kind, content, extra = {}) {
  return {
    id,
    messageId: 7,
    kind,
    source: "LIVE",
    snapshotContent: content,
    snapshotAttachmentsJson: null,
    previousContent: null,
    authorId: "account",
    authorPlatformId: "user",
    isBot: false,
    ...extra,
  };
}
function service(events, fromExclusive = 0) {
  return new HistoryService(
    {
      snapshot: async () => ({
        events,
        fromExclusive,
        throughInclusive: events.at(-1)?.id ?? 0,
      }),
    },
    { findGenerationInputsByIds: async () => new Map() },
  );
}

test("observed edits and deletion preserve original speech as immutable model input", async () => {
  const events = [
    event(1, "READ", "하 시발"),
    event(2, "EDIT", "아 그게", { previousContent: "하 시발" }),
    event(3, "DELETE", "아 그게"),
  ];
  const result = await service(events).fetchHistoryData("channel", "bot");
  assert.equal(result.pendingMessages.length, 3);
  assert.equal(result.pendingMessages[0].content, "하 시발");
  assert.equal(
    result.pendingMessages[1].content,
    '[수정 목격]\n이전에 읽은 내용: "하 시발"\n현재 내용: "아 그게"',
  );
  assert.equal(
    result.pendingMessages[2].content,
    '[삭제 목격]\n이전에 읽은 내용: "아 그게"\n삭제 실행자와 이유는 알 수 없음.',
  );
  assert.deepEqual(result.messageIds, [7, 7, 7]);
  assert.deepEqual(result.eventSnapshot.inputEventIds, [1, 2, 3]);
});

test("observation annotations omit message IDs without changing quoted content", async () => {
  const result = await service([
    event(1, "DELETE", "메시지 #110", {
      messageId: null,
      platformMessageId: "discord-message-id",
      batchId: "batch-1",
    }),
    event(2, "READ", "edited", { editedAt: new Date() }),
    event(3, "READ", "past", { source: "HISTORY" }),
    event(4, "READ", "edited past", { source: "HISTORY", editedAt: new Date() }),
  ]).fetchHistoryData("channel", "bot");
  assert.deepEqual(result.pendingMessages.map((item) => item.content), [
    '[삭제 목격; 일괄 삭제 batch-1]\n이전에 읽은 내용: "메시지 #110"\n삭제 실행자와 이유는 알 수 없음.',
    "[수정됨 표시 있음]\nedited",
    "[현재 과거 내역에서 읽은 메시지]\npast",
    "[현재 과거 내역에서 읽은 메시지; 수정됨 표시 있음, 편집 시점은 목격하지 않음]\nedited past",
  ]);
});

test("context uses the last delivered chunk while input uses the completion cursor", async () => {
  const result = await service(
    [
      event(1, "READ", "old"),
      event(2, "SENT", "partial", { isBot: true, authorPlatformId: "bot" }),
      event(3, "EDIT", "new", { previousContent: "old" }),
    ],
    1,
  ).fetchHistoryData("channel", "bot");
  assert.deepEqual(
    result.pendingMessages.map((item) => item.eventId),
    [3],
  );
  assert.equal(result.inputMessages.length, 1);
  assert.deepEqual(
    result.historyMessages.map((item) => item.eventId),
    [1, 2],
  );
});

test("reading an edited historical message does not invent an observed edit or new input", async () => {
  const result = await service([
    event(1, "READ", "current", { source: "HISTORY", editedAt: new Date() }),
  ]).fetchHistoryData("channel", "bot");
  assert.equal(result.inputMessages.length, 0);
  assert.match(
    result.pendingMessages[0].content,
    /수정됨 표시 있음, 편집 시점은 목격하지 않음/,
  );
});

test("unknown previous content is never reconstructed for deletion", async () => {
  const result = await service([event(1, "DELETE", null)]).fetchHistoryData(
    "channel",
    "bot",
  );
  assert.match(result.pendingMessages[0].content, /이전에 읽은 내용: 미상/);
});

test("completion alone cannot move observations into history", async () => {
  const events = [event(1, "READ", "same"), event(2, "EDIT", "same")];
  const before = await service(events).fetchHistoryData("channel", "bot");
  const after = await service(events, 2).fetchHistoryData("channel", "bot");
  assert.deepEqual(after.pendingMessages, before.pendingMessages);
  assert.deepEqual(after.historyMessages, []);
  assert.equal(before.inputMessages.length, 2);
  assert.equal(after.inputMessages.length, 0);
});

test("historical bot reads and edits are observations, not new bot speech", async () => {
  const result = await service([
    event(1, "SENT", "sent", { isBot: true, authorPlatformId: "bot" }),
    event(2, "EDIT", "changed", { isBot: true, authorPlatformId: "bot" }),
    event(3, "READ", "old bot message", {
      source: "HISTORY", isBot: true, authorPlatformId: "bot",
    }),
    event(4, "DELETE", null),
  ]).fetchHistoryData("channel", "bot");
  assert.deepEqual(result.historyMessages.map((item) => item.eventId), [1]);
  assert.deepEqual(result.pendingMessages.map((item) => item.eventId), [2, 3, 4]);
  assert.ok(result.pendingMessages.every((item) => item.authorPlatformId === null));
});

test("the latest delivered chunk closes history even without later observations", async () => {
  const result = await service([
    event(1, "READ", "input"),
    event(2, "SENT", "first chunk", { isBot: true, authorPlatformId: "bot" }),
    event(3, "READ", "interleaved input"),
    event(4, "SENT", "second chunk", { isBot: true, authorPlatformId: "bot" }),
  ]).fetchHistoryData("channel", "bot");
  assert.deepEqual(result.historyMessages.map((item) => item.eventId), [1, 2, 3, 4]);
  assert.deepEqual(result.pendingMessages, []);
  assert.deepEqual(result.eventSnapshot.inputEventIds, [1, 3]);
});

test("replay merges by event ID without collapsing edits with identical content", async () => {
  const events = [
    event(1, "SENT", "reply", { isBot: true, authorPlatformId: "bot" }),
    event(2, "READ", "same"),
    event(3, "EDIT", "same"),
    event(4, "DELETE", "same"),
  ];
  const history = new HistoryService({
    snapshot: async () => ({
      events,
      fromExclusive: 3,
      replay: { events: events.slice(0, 3), inputEventIds: [2, 3] },
    }),
  }, { findGenerationInputsByIds: async () => new Map() });
  const result = await history.fetchHistoryData("channel", "bot", 10);
  assert.deepEqual(result.eventSnapshot.events.map((item) => item.id), [1, 2, 3, 4]);
  assert.deepEqual(result.historyMessages.map((item) => item.eventId), [1]);
  assert.deepEqual(result.pendingMessages.map((item) => item.eventId), [2, 3, 4]);
  assert.deepEqual(result.eventSnapshot.inputEventIds.sort(), [2, 3, 4]);
});
