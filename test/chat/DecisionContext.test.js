import test from "node:test";
import assert from "node:assert/strict";
import {
  DecisionContext,
  estimateDecisionTokens,
} from "../../src/chat/decision/DecisionContext.js";

function event(id, extra = {}) {
  return {
    id,
    platformMessageId: `m${id}`,
    authorPlatformId: "human",
    authorDisplayName: "사용자",
    source: "LIVE",
    kind: "READ",
    snapshotContent: `내용 ${id}`,
    observedAt: new Date(),
    ...extra,
  };
}
function harness(events, options = {}) {
  const settings = {
    maxContextMessages: 20,
    maxContextTokens: 4000,
    character: "짧은 소개",
    rules: "참여 규칙",
    ...options,
  };
  const calls = [];
  const context = new DecisionContext(
    {
      decisionContext: async (...args) => {
        calls.push(args);
        return {
          events,
          lastSentId: events.find((e) => e.kind === "SENT")?.id,
        };
      },
    },
    settings,
    "fixture",
    { isEnabled: async () => true },
  );
  const request = {
    channelPort: { platform: "discord", platformChannelId: "channel" },
    internalChannelId: "internal",
    botId: "bot",
  };
  const batch = {
    ids: new Set(["m3"]),
    metadata: new Map(),
    throughEventId: 2,
    lastAt: performance.now(),
    rechecks: 0,
    omitted: 0,
  };
  const assistant = { active: true, inputThroughEventId: 2 };
  const build = () =>
    context.build(request, batch, assistant, new AbortController().signal);
  return { settings, calls, context, request, batch, build };
}

test("decision context marks new observations separately from current generation input and preserves edits/deletes", async () => {
  const h = harness([
    event(1, { kind: "SENT", authorPlatformId: "bot" }),
    event(2, { source: "HISTORY" }),
    event(3, {
      kind: "EDIT",
      previousContent: "옛 질문",
      snapshotContent: "새 질문 <@123>",
    }),
    event(4, { kind: "DELETE" }),
  ]);
  h.batch.ids.add("m4");
  const result = await h.build();
  assert.equal(result.throughEventId, 4);
  assert.deepEqual(
    result.state.messages.map((m) => m.isNew),
    [false, false, true, true],
  );
  assert.deepEqual(
    result.state.messages.map((m) => m.inCurrentResponse),
    [true, true, false, false],
  );
  assert.equal(result.state.messages[2].previousContent, "옛 질문");
  assert.deepEqual(result.state.messages[2].mentionedUserIds, ["123"]);
  assert.equal(result.state.messages[3].kind, "DELETE");
  assert.equal(
    h.batch.throughEventId,
    2,
    "building context never acknowledges input",
  );
  assert.equal(h.calls[0][2], 20);
});

test("reply targets outside history are fetched only through the authorized channel and deduplicated", async () => {
  const h = harness([event(3)]);
  h.batch.metadata.set("m3", {
    replyToMessageId: "old",
    mentionedUserIds: ["bot"],
  });
  let reads = 0;
  h.request.channelPort.readMessage = async (id) => {
    reads++;
    assert.equal(id, "old");
    return {
      content: "원문",
      author: { platformUserId: "human", displayName: "이전 사용자" },
    };
  };
  const { state } = await h.build();
  assert.equal(reads, 1);
  assert.equal(state.messages.find((m) => m.isReplyTarget).content, "원문");
  assert.equal(
    state.messages.find((m) => m.messageId === "m3").replyToMessageId,
    "old",
  );
  h.context.conversationPolicy.isEnabled = async () => false;
  await h.build();
  assert.equal(reads, 1);
});

test("inaccessible reply is explicitly unknown, and shutdown abort is propagated", async () => {
  const h = harness([event(3)]);
  h.batch.metadata.set("m3", { replyToMessageId: "gone" });
  h.request.channelPort.readMessage = async () => {
    throw new Error("not found");
  };
  const { state } = await h.build();
  assert.equal(
    state.messages.find((m) => m.messageId === "gone").unavailable,
    true,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    h.context.build(h.request, h.batch, {}, controller.signal),
    { name: "AbortError" },
  );
});

test("long Korean messages and metadata stay within the estimated token budget with explicit truncation", async () => {
  const h = harness(
    Array.from({ length: 20 }, (_, i) =>
      event(i + 1, {
        snapshotContent: "긴한국어메시지😀".repeat(5000),
      }),
    ),
    { maxContextTokens: 1000 },
  );
  h.batch.ids = new Set(["m20"]);
  const { state } = await h.build();
  assert.ok(estimateDecisionTokens(state) <= 1000);
  assert.ok(state.messages.some((m) => m.messageId === "m20" && m.isNew));
  assert.ok(state.messages.some((m) => m.truncated));
  assert.ok(state.omittedMessages > 0);
});

test("last sent message and referenced observations take priority over older history", async () => {
  const events = [
    event(1, { kind: "SENT", authorPlatformId: "bot" }),
    ...Array.from({ length: 20 }, (_, i) => event(i + 2)),
  ];
  const h = harness(events, { maxContextTokens: 1000 });
  h.batch.ids = new Set(["m21"]);
  const { state } = await h.build();
  assert.ok(state.messages.some((m) => m.eventId === 1));
  assert.ok(state.messages.some((m) => m.eventId === 21));
});

test("a long new message leaves room for the last bot reply", async () => {
  const h = harness([
    event(1, { kind: "SENT", authorPlatformId: "bot" }),
    event(3, { snapshotContent: "긴본문".repeat(4000) }),
  ]);
  const { state } = await h.build();
  assert.ok(
    state.messages.some((m) => m.eventId === 3 && m.isNew && m.truncated),
  );
  assert.ok(state.messages.some((m) => m.eventId === 1));
  assert.ok(estimateDecisionTokens(state) <= 4000);
});
