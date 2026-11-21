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
    sentAt: new Date(Date.UTC(2026, 10, 17, 13, id)),
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
    { isEnabled: async () => true },
    { timeZone: "Asia/Seoul" },
  );
  const request = {
    channelPort: { platform: "discord", platformChannelId: "channel" },
    channelRecord: { serverId: "server" },
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
  const assistant = {
    active: true,
    inputThroughEventId: 2,
    turnId: "internal-turn",
    deliveryVersion: 3,
  };
  const build = () =>
    context.build(request, batch, assistant, new AbortController().signal);
  return { settings, calls, context, request, batch, assistant, build };
}

test("ordinary messages use chat headers only when needed and carry no decision flags", async () => {
  const h = harness([event(1), event(2), event(3)]);
  h.assistant.active = false;
  const { state } = await h.build();
  assert.deepEqual(state.messages, [
    {
      role: "user",
      content: "--- 2026년 11월 17일 ---\n[22:01] 사용자\n내용 1",
    },
    { role: "user", content: "내용 2" },
    { role: "user", content: "내용 3", tags: ["새 입력"] },
  ]);
});

test("observed mentions identify their recipients and attachment-only messages retain their meaning", async () => {
  const h = harness([
    event(1, { authorPlatformId: "123", authorHandle: "one" }),
    event(2, {
      authorPlatformId: "456",
      authorHandle: "two",
      snapshotContent: "",
      snapshotAttachmentsJson: '[{"name":"photo.png"}]',
    }),
    event(3, {
      authorPlatformId: "123",
      authorHandle: "one",
      snapshotContent: "<@!456> <@789> 봐줘",
    }),
  ]);
  h.request.botId = "789";
  h.assistant.active = false;
  const { state } = await h.build();
  assert.deepEqual(state.messages[1].tags, ["첨부"]);
  assert.deepEqual(state.messages[2].tags, ["새 입력", "봇 멘션"]);
  assert.match(
    state.messages[2].content,
    /사용자 \(@one\)\n@사용자 \(@two\) @봇 봐줘$/,
  );
  assert.doesNotMatch(JSON.stringify(state.messages), /123|456|789|photo\.png/);
});

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
    result.state.messages.map((m) => m.tags),
    [
      ["현재 답변에 포함"],
      ["현재 답변에 포함", "과거 조회"],
      ["새 입력", "수정"],
      ["새 입력", "삭제"],
    ],
  );
  assert.equal(result.state.messages[2].previousContent, "옛 질문");
  assert.match(result.state.messages[2].content, /새 질문 @알 수 없는 사용자$/);
  assert.equal(result.state.messages[0].role, "assistant");
  assert.deepEqual(result.state.assistant, { active: true });
  assert.doesNotMatch(
    JSON.stringify(result.state),
    /"characterId"|"botId"|"eventId"|"messageId"|"observedAt"|"source"/,
  );
  assert.equal(
    h.batch.throughEventId,
    2,
    "building context never acknowledges input",
  );
  assert.equal(h.calls[0][2], 20);
});

test("rechecks include their count and elapsed silence without classifying the reason for waiting", async () => {
  const h = harness([event(3, { snapshotContent: "잠깐 기다려줘" })]);
  h.batch.rechecks = 4;
  h.batch.lastAt = performance.now() - 10000;
  h.request.channelPort.isDirect = true;
  h.request.channelRecord.serverId = null;
  const { state } = await h.build();
  assert.equal(state.isDirect, true);
  assert.equal(state.recheckCount, 4);
  assert.ok(state.silenceMs >= 10000);
  assert.match(state.messages[0].content, /\[22:03\]\n잠깐 기다려줘$/);
  assert.deepEqual(state.messages[0].tags, ["새 입력"]);
  assert.equal(state.waitReason, undefined);
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
  const [target, reply] = state.messages;
  assert.deepEqual(reply.tags, ["새 입력", "봇 멘션"]);
  assert.equal(reply.replyTo, "#1");
  assert.match(target.content, /#1 원문$/);
  h.context.conversationPolicy.isEnabled = async () => false;
  assert.equal((await h.build()).state.messages[0].replyTo, "?");
  assert.equal(reads, 1);
});

test("inaccessible reply is explicitly unknown, and shutdown abort is propagated", async () => {
  const h = harness([event(3)]);
  h.batch.metadata.set("m3", { replyToMessageId: "gone" });
  h.request.channelPort.readMessage = async () => {
    throw new Error("not found");
  };
  const { state } = await h.build();
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].replyTo, "?");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    h.context.build(h.request, h.batch, {}, controller.signal),
    { name: "AbortError" },
  );
});

test("past replies keep visible links without fetching old targets again", async () => {
  const h = harness([event(1), event(2), event(3)]);
  h.batch.metadata.set("m1", { replyToMessageId: "outside" });
  h.batch.metadata.set("m2", { replyToMessageId: "m1" });
  let reads = 0;
  h.request.channelPort.readMessage = async () => {
    reads++;
  };
  const { state } = await h.build();
  assert.deepEqual(h.calls[0][3], []);
  assert.equal(reads, 0);
  assert.equal(state.messages[0].replyTo, "?");
  assert.ok(
    state.messages[0].content.endsWith(state.messages[1].replyTo + " 내용 1"),
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
  assert.equal(
    state.messages.filter((m) => m.tags?.includes("새 입력")).length,
    1,
  );
  assert.ok(state.messages.some((m) => m.tags?.includes("일부 생략")));
  assert.ok(state.omittedMessages > 0);
  assert.match(state.messages[0].content, /\[22:\d\d\] 사용자\n/);
});

test("last sent message and referenced observations take priority over older history", async () => {
  const events = [
    event(1, {
      kind: "SENT",
      authorPlatformId: "bot",
      authorDisplayName: "봇",
    }),
    event(2),
    ...Array.from({ length: 18 }, (_, i) =>
      event(i + 3, { snapshotContent: "긴 대화 ".repeat(100) }),
    ),
    event(21),
  ];
  const h = harness(events, { maxContextTokens: 1000 });
  h.batch.ids = new Set(["m21"]);
  h.batch.metadata.set("m21", { replyToMessageId: "m2" });
  const { state } = await h.build();
  assert.ok(state.omittedMessages > 0);
  assert.equal(state.messages[0].content, "내용 1");
  assert.match(state.messages[1].content, /\[22:02\] 사용자\n#1 내용 2$/);
  assert.ok(state.messages.at(-1).content.endsWith("내용 21"));
  assert.equal(state.messages.at(-1).replyTo, "#1");
});

test("a long new message leaves room for the last bot reply", async () => {
  const h = harness([
    event(1, { kind: "SENT", authorPlatformId: "bot" }),
    event(3, { snapshotContent: "긴본문".repeat(4000) }),
  ]);
  const { state } = await h.build();
  assert.ok(
    state.messages.some(
      (m) => m.tags?.includes("새 입력") && m.tags.includes("일부 생략"),
    ),
  );
  assert.ok(state.messages.some((m) => m.content === "내용 1"));
  assert.ok(estimateDecisionTokens(state) <= 4000);
});
