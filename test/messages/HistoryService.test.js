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
  assert.match(result.pendingMessages[1].content, /수정 목격/);
  assert.match(result.pendingMessages[1].content, /하 시발/);
  assert.match(
    result.pendingMessages[2].content,
    /삭제 실행자와 이유는 알 수 없음/,
  );
  assert.deepEqual(result.eventSnapshot.inputEventIds, [1, 2, 3]);
});

test("pending uses the completion cursor even if a bot chunk was already delivered", async () => {
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
    [2, 3],
  );
  assert.equal(result.inputMessages.length, 1);
  assert.deepEqual(
    result.historyMessages.map((item) => item.eventId),
    [1],
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
