import test from "node:test";
import assert from "node:assert/strict";
import { CharacterContextBuilder } from "../../../src/character/CharacterContextBuilder.js";
import { PromptComposer } from "../../../src/chat/context/PromptComposer.js";
import { SequenceBuilder } from "../../../src/chat/context/SequenceBuilder.js";
import { HistoryService } from "../../../src/messages/HistoryService.js";
import { buildSystemContext } from "../../../src/utils/renderTemplate.js";

function event(id, kind, content, extra = {}) {
  return {
    id,
    messageId: id,
    kind,
    source: "LIVE",
    snapshotContent: content,
    snapshotAttachmentsJson: null,
    previousContent: null,
    authorPlatformId: kind === "SENT" ? "bot" : "user",
    isBot: kind === "SENT",
    observedAt: new Date(
      `2026-09-24T10:00:${String(id).padStart(2, "0")}.123Z`,
    ),
    ...extra,
  };
}

async function harness({ timezone = "Asia/Seoul", language = "ko-KR" } = {}) {
  let characterBuilds = 0;
  const character = new CharacterContextBuilder({
    identityPath: "test/fixtures/character/identity.md",
    variablesPath: "test/fixtures/character/variables.json",
  });
  const composer = new PromptComposer(
    {
      getAll: () => ({ app: { timezone, language } }),
    },
    {
      build: async (options) => {
        characterBuilds++;
        return character.build(options);
      },
    },
  );
  const builder = new SequenceBuilder(composer, {
    promptsRoot: "test/fixtures/prompts",
  });
  const sequence = await builder.loadSequence("minimal");
  return {
    characterBuilds: () => characterBuilds,
    compose: async (events, referenceDate, fromExclusive = 0) => {
      const history = new HistoryService(
        {
          snapshot: async () => ({ events, fromExclusive }),
        },
        { findGenerationInputsByIds: async () => new Map() },
      );
      const input = await history.fetchHistoryData("channel", "bot");
      return builder.build(sequence, {
        ...input,
        promptName: "minimal",
        botId: "bot",
        referenceDate,
      });
    },
  };
}

test("all observations retain roles, order and timestamps across response boundaries", async () => {
  const h = await harness();
  const events = Array.from({ length: 25 }, (_, i) =>
    event(i + 1, "READ", `message ${i + 1}`),
  );
  events.push(event(26, "SENT", "first reply"));
  events.push(event(27, "READ", "same"));
  events.push(
    event(28, "EDIT", "same", { messageId: 27, previousContent: "same" }),
  );
  events.push(event(29, "DELETE", "same", { messageId: 27 }));
  events.push(
    event(30, "READ", "historical bot", {
      source: "HISTORY",
      authorPlatformId: "bot",
      isBot: true,
    }),
  );
  const date = new Date("2026-09-24T13:40:00.999Z");
  const first = await h.compose(events, date);
  assert.equal(h.characterBuilds(), 1);
  assert.equal(first.context.length, 32);
  assert.deepEqual(first.context[1], {
    role: "user",
    content: "[2026년 9월 24일 목요일 오후 7:00]\nmessage 1",
  });
  assert.equal(first.context[2].content, "message 2");
  assert.equal(first.context[26].role, "assistant");
  assert.match(first.context[27].content, /2026-09-24T22:40:00\+09:00/);
  assert.deepEqual(
    first.context.slice(28).map((item) => item.role),
    ["user", "user", "user", "user"],
  );
  assert.match(first.context[29].content, /수정 목격/);
  assert.match(first.context[30].content, /삭제 목격/);
  assert.match(first.context[31].content, /과거 내역/);

  const later = await h.compose(events, new Date("2026-09-24T13:40:01Z"), 30);
  assert.equal(first.systemInstruction, later.systemInstruction);
  assert.deepEqual(first.context.slice(0, 27), later.context.slice(0, 27));
  assert.notEqual(first.context[27].content, later.context[27].content);
  assert.deepEqual(first.context.slice(28), later.context.slice(28));

  events.push(event(31, "SENT", "next reply"));
  events.push(event(32, "READ", "new input"));
  const next = await h.compose(events, date, 30);
  assert.deepEqual(first.context.slice(0, 27), next.context.slice(0, 27));
  assert.deepEqual(first.context.slice(28), next.context.slice(27, 31));
  assert.equal(next.context[31].role, "assistant");
  assert.match(next.context[32].content, /## messages/);
  assert.match(next.context[33].content, /new input$/);
  assert.equal(
    next.context.filter((item) => item.content.includes("## Current Time"))
      .length,
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(next),
    /<Recent>|<This_Moment>|<User_Action>|<Foundation>|<Deep_Memory>/,
  );
});

test("time markers use five-minute gaps between events and survive delivery", async () => {
  const h = await harness();
  const date = new Date("2026-09-24T13:40:00Z");
  const events = [
    event(1, "READ", "first", { observedAt: "2026-09-24T10:00:00Z" }),
    event(2, "SENT", "reply", { observedAt: "2026-09-24T10:04:59.999Z" }),
    event(3, "READ", "original", { observedAt: "2026-09-24T10:09:59.998Z" }),
    event(4, "EDIT", "edited", {
      messageId: 3,
      previousContent: "original",
      observedAt: "2026-09-24T10:09:59.999Z",
    }),
    event(5, "DELETE", "edited", {
      messageId: 3,
      observedAt: "2026-09-24T10:14:59.999Z",
    }),
    event(6, "READ", "old bot message", {
      source: "HISTORY",
      authorPlatformId: "bot",
      isBot: true,
      observedAt: "2026-09-24T10:15:00Z",
    }),
    event(7, "READ", "back", { observedAt: "2026-09-24T11:00:00Z" }),
  ];
  const first = await h.compose(events, date);
  assert.equal(first.context[1].content, "[2026년 9월 24일 목요일 오후 7:00]\nfirst");
  assert.equal(first.context[2].content, "reply");
  assert.match(first.context[3].content, /## Current Time/);
  assert.equal(first.context[4].content, "original");
  assert.equal(
    first.context[5].content,
    '[수정 목격]\n이전에 읽은 내용: "original"\n현재 내용: "edited"',
  );
  assert.equal(
    first.context[6].content,
    '[2026년 9월 24일 목요일 오후 7:14]\n[삭제 목격]\n이전에 읽은 내용: "edited"\n삭제 실행자와 이유는 알 수 없음.',
  );
  assert.deepEqual(first.context[7], {
    role: "user",
    content: "[현재 과거 내역에서 읽은 메시지]\nold bot message",
  });
  assert.equal(first.context[8].content, "[2026년 9월 24일 목요일 오후 8:00]\nback");

  events.push(event(8, "SENT", "welcome back", {
    observedAt: "2026-09-24T11:00:01Z",
  }));
  events.push(event(9, "READ", "next", { observedAt: "2026-09-24T11:00:02Z" }));
  const next = await h.compose(events, new Date("2026-09-24T13:41:00Z"), 8);
  assert.deepEqual(next.context.slice(1, 8), [
    ...first.context.slice(1, 3),
    ...first.context.slice(4),
  ]);
  assert.equal(next.context[8].content, "welcome back");
  assert.match(next.context[9].content, /## Current Time/);
  assert.equal(next.context[10].content, "next");
});

test("missing observation times are not inferred", async () => {
  const h = await harness();
  const result = await h.compose(
    [
      event(1, "READ", "unknown", { observedAt: null }),
      event(2, "READ", "known", { observedAt: "2026-09-24T10:00:00Z" }),
      event(3, "READ", "unknown again", { observedAt: null }),
      event(4, "READ", "known again", { observedAt: "2026-09-24T10:00:01Z" }),
    ],
    new Date("2026-09-24T13:40:00Z"),
  );
  assert.deepEqual(result.context.slice(2).map((item) => item.content), [
    "unknown",
    "[2026년 9월 24일 목요일 오후 7:00]\nknown",
    "unknown again",
    "[2026년 9월 24일 목요일 오후 7:00]\nknown again",
  ]);
});

test("observation times follow the configured timezone and language", async (t) => {
  const cases = [
    {
      timezone: "Asia/Seoul",
      date: "2026-09-29T00:00:00Z",
      expected: "2026년 9월 29일 화요일 오전 9:00",
    },
    {
      timezone: "UTC",
      date: "2026-09-29T00:00:00Z",
      expected: "2026년 9월 29일 화요일 오전 12:00",
    },
    {
      timezone: "America/New_York",
      date: "2026-09-29T00:00:00Z",
      expected: "2026년 9월 28일 월요일 오후 8:00",
    },
    {
      timezone: "America/New_York",
      date: "2026-01-29T00:00:00Z",
      expected: "2026년 1월 28일 수요일 오후 7:00",
    },
    {
      timezone: "Asia/Kathmandu",
      date: "2026-09-29T00:00:00Z",
      expected: "2026년 9월 29일 화요일 오전 5:45",
    },
    {
      timezone: "America/New_York",
      language: "en-US",
      date: "2026-09-29T00:00:00Z",
      expected: "Monday, September 28, 2026 at 8:00 PM",
    },
  ];
  for (const { timezone, language = "ko-KR", date, expected } of cases) {
    await t.test(`${timezone} / ${language} / ${date}`, async () => {
      const h = await harness({ timezone, language });
      const result = await h.compose(
        [event(1, "READ", "hello", { observedAt: date })],
        new Date("2026-09-30T00:00:00Z"),
      );
      assert.equal(result.context.at(-1).content, `[${expected}]\nhello`);
    });
  }
});

test("first response puts all observations after instructions and an empty tail adds nothing", async () => {
  const h = await harness();
  const date = new Date("2026-09-24T00:00:00Z");
  const read = event(1, "READ", "first");
  const first = await h.compose([read], date);
  assert.match(first.context[1].content, /## Current Time/);
  assert.match(first.context[2].content, /first$/);
  const delivered = await h.compose([read, event(2, "SENT", "reply")], date);
  assert.equal(delivered.context.length, 4);
  assert.deepEqual(delivered.context[1], first.context[2]);
  assert.equal(delivered.context[2].role, "assistant");
  assert.match(delivered.context.at(-1).content, /## Current Time/);
});

test("current time uses actual timezone offsets, seconds and local calendar fields", () => {
  const date = new Date("2026-09-24T23:40:00.987Z");
  const seoul = buildSystemContext(date, "Asia/Seoul").now;
  assert.equal(seoul.raw, "2026-09-25T08:40:00+09:00");
  assert.equal(seoul.date, "2026-09-25");
  assert.equal(seoul.weekday, "금요일");
  assert.equal(seoul.time, "08:40");
  assert.equal(
    buildSystemContext(date, "UTC").now.raw,
    "2026-09-24T23:40:00+00:00",
  );
  assert.equal(
    buildSystemContext(date, "Asia/Kathmandu").now.raw,
    "2026-09-25T05:25:00+05:45",
  );
  assert.equal(
    buildSystemContext(date, "America/New_York").now.raw,
    "2026-09-24T19:40:00-04:00",
  );
  assert.equal(
    buildSystemContext(new Date("2026-01-24T23:40:00Z"), "America/New_York").now
      .raw,
    "2026-01-24T18:40:00-05:00",
  );
});
