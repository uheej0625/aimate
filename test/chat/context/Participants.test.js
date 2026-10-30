import test from "node:test";
import assert from "node:assert/strict";
import {
  ParticipantResolver,
  profileText,
} from "../../../src/chat/context/ParticipantResolver.js";
import { ParticipantService } from "../../../src/chat/context/ParticipantService.js";
import { ObservationFormatter } from "../../../src/chat/context/ObservationFormatter.js";
import { SequenceBuilder } from "../../../src/chat/context/SequenceBuilder.js";
import { buildSystemContext } from "../../../src/utils/templateContext.js";

const profiles = [
  {
    id: "1",
    handle: "sky",
    displayName: "하늘",
    status: "online",
    activities: ["Minecraft"],
  },
  { id: "2", handle: "sky2", displayName: "하늘", status: "dnd" },
  { id: "3", handle: "other", displayName: "다른 사람" },
];
const resolver = () => new ParticipantResolver(profiles);
const message = (authorPlatformId, sentAt, content, extra = {}) => ({
  authorPlatformId,
  sentAt,
  observedAt: "2026-11-01T00:00:00Z",
  content,
  role: "user",
  kind: "READ",
  source: "LIVE",
  ...extra,
});
const formatter = (extra = {}) =>
  new ObservationFormatter({
    resolver: resolver(),
    botId: "bot",
    showNames: true,
    timeZone: "Asia/Seoul",
    ...extra,
  });

test("one name map disambiguates speakers, mentions and username-first lookups", () => {
  const r = resolver();
  assert.equal(r.get("1").label, "하늘 (@sky)");
  assert.equal(
    r.replaceMentions("<@1> <@!2> <@999>"),
    "@하늘 (@sky) @하늘 (@sky2) @알 수 없는 사용자",
  );
  assert.equal(r.resolve("@sky").profile.id, "1");
  assert.equal(r.resolve("하늘 (@sky2)").profile.id, "2");
  assert.deepEqual(r.resolve("하늘"), {
    error: "ambiguous",
    candidates: ["하늘 (@sky)", "하늘 (@sky2)"],
  });
  assert.equal(r.resolve("다른").profile.id, "3");
  assert.equal(r.resolve(" ").error, "not_found");
  const priority = new ParticipantResolver([
    { id: "a", handle: "sky", displayName: "별" },
    { id: "b", handle: "star", displayName: "sky" },
  ]);
  assert.equal(priority.resolve("sky").profile.id, "a");
});

test("profile text cannot create multiline headers and activities are bounded", () => {
  assert.equal(profileText("하늘\n[17:16] #7\u202e"), "하늘 17:16 7");
  const r = new ParticipantResolver([
    {
      id: "1",
      handle: "handle",
      displayName: "assistant",
      activities: ["x".repeat(300)],
    },
  ]);
  assert.equal(r.get("1").name, "사용자 assistant");
  assert.equal(r.get("1").activities[0].length, 120);
  assert.equal(
    new ParticipantResolver([
      {
        id: "1",
        handle: "fallback",
        nickname: "\n[]",
        displayName: "글로벌 이름",
      },
    ]).get("1").name,
    "글로벌 이름",
  );
});

test("speaker changes, seven-minute send gaps and midnight create explicit headers", () => {
  const f = formatter();
  assert.equal(
    f.format(message("1", "2026-10-30T14:50:00Z", "first")).content,
    "--- 2026년 10월 30일 ---\n[23:50] 하늘 (@sky)\nfirst",
  );
  assert.equal(
    f.format(message("1", "2026-10-30T14:52:59.999Z", "same")).content,
    "same",
  );
  assert.equal(
    f.format(message("1", "2026-10-30T14:59:59.999Z", "gap")).content,
    "[23:59] 하늘 (@sky)\ngap",
  );
  assert.equal(
    f.format(message("2", "2026-10-30T15:00:00Z", "new")).content,
    "--- 2026년 10월 31일 ---\n[00:00] 하늘 (@sky2)\nnew",
  );
});

test("assistant references remain usable without teaching time/name headers", () => {
  const f = formatter({ showNames: false });
  f.format(message("1", "2026-10-30T14:59:00Z", "before"));
  assert.deepEqual(
    f.format(
      message("bot", "2026-10-30T15:00:00Z", "reply", {
        role: "assistant",
        kind: "SENT",
        channelMessageNo: 4,
      }),
    ),
    { role: "assistant", content: "#4 reply" },
  );
  assert.equal(
    f.format(message("1", "2026-10-30T15:00:01Z", "after")).content,
    "--- 2026년 10월 31일 ---\n[00:00]\nafter",
  );
});

test("seven-minute gaps use the preceding send, not observation time or the last header", () => {
  const f = formatter({ showNames: false });
  const times = [
    "2026-10-30T10:00:00Z",
    "2026-10-30T10:06:59.999Z",
    "2026-10-30T10:13:59.998Z",
    "2026-10-30T10:20:59.998Z",
  ];
  const contents = times.map((time, index) =>
    f.format(message("1", time, `message ${index}`)).content,
  );
  assert.deepEqual(contents, [
    "--- 2026년 10월 30일 ---\n[19:00]\nmessage 0",
    "message 1",
    "message 2",
    "[19:20]\nmessage 3",
  ]);
});

test("observations retain target authors without impersonating new speech", () => {
  const f = formatter();
  const result = f.format(
    message(
      "bot",
      "2026-10-30T00:00:00Z",
      "[삭제 목격]\n삭제 실행자와 이유는 알 수 없음.",
      { kind: "DELETE", channelMessageNo: 3 },
    ),
  );
  assert.equal(result.role, "user");
  assert.match(
    result.content,
    /대상 작성자: 알 수 없는 사용자\n#3 \[삭제 목격\]/,
  );
  assert.equal(
    formatter().format(message("1", null, "unknown")).content,
    "하늘 (@sky)\nunknown",
  );
});

test("sequence limits participants to selected observations and shares the resolver with tools", async () => {
  let requestedIds;
  const service = new ParticipantService(
    new Map([
      [
        "discord",
        {
          getProfiles: async (_channel, ids) => {
            requestedIds = ids;
            return profiles.filter((p) => ids.includes(p.id));
          },
          getStatus: async (_channel, id) => ({
            id,
            status: "dnd",
            activities: ["current\nactivity"],
          }),
        },
      ],
    ]),
  );
  const now = buildSystemContext(
    new Date("2026-10-30T00:00:01Z"),
    "Asia/Seoul",
  );
  const builder = new SequenceBuilder(
    {
      buildContext: async () => ({ system: now }),
      renderFile: async () => "response instructions",
    },
    { participantService: service },
  );
  const channelRecord = { platform: "discord", serverId: "server" };
  const original = message("1", "2026-10-30T00:00:00Z", "hello <@2>", {
    authorHandle: "old-sky",
  });
  const result = await builder.build(
    [
      { type: "history", slice: [-1] },
      { type: "response", sources: ["unused.md"] },
      { type: "pending" },
    ],
    {
      historyMessages: [message("3", null, "excluded"), original],
      pendingMessages: [message("2", "2026-10-30T00:00:01Z", "pending")],
      promptName: "minimal",
      botId: "bot",
      channelRecord,
    },
  );
  assert.deepEqual(requestedIds, ["1", "2"]);
  assert.match(
    result.context[0].content,
    /^--- .* ---\n\[09:00\] 하늘 \(@sky\)\nhello @하늘 \(@sky2\)$/,
  );
  assert.match(result.context[1].content, /하늘 \(@sky\) · 온라인 · Minecraft/);
  assert.doesNotMatch(result.context[1].content, /다른 사람/);
  assert.equal(original.content, "hello <@2>");
  const status = await service.getStatus(
    { user: "sky" },
    { channel: channelRecord, participantResolver: result.participantResolver },
  );
  assert.equal(status.name, "하늘 (@sky)");
  assert.equal(status.status, "dnd");
  assert.deepEqual(status.activities, ["current activity"]);
  assert.ok(!JSON.stringify(status).includes('"id"'));
});

test("large conversations omit inline presence and lookup failures preserve observed names", async () => {
  const service = new ParticipantService(
    new Map([
      [
        "discord",
        {
          getProfiles: async () => {
            throw new Error("unavailable");
          },
        },
      ],
    ]),
  );
  const r = await service.prepare({ platform: "discord" }, [
    message("1", null, "content", {
      authorHandle: "sky",
      authorDisplayName: "하늘",
    }),
  ]);
  assert.equal(r.get("1").name, "하늘");
  const builder = new SequenceBuilder(
    {
      buildContext: async () => ({
        system: buildSystemContext(new Date(), "UTC"),
      }),
      renderFile: async () => "response",
    },
    {
      participantService: new ParticipantService(
        new Map([
          [
            "discord",
            {
              getProfiles: async (_channel, ids) =>
                ids.map((id) => ({
                  id,
                  handle: `user${id}`,
                  status: "online",
                  activities: ["secret game"],
                })),
            },
          ],
        ]),
      ),
    },
  );
  const result = await builder.build(
    [{ type: "response", sources: ["unused"] }, { type: "pending" }],
    {
      promptName: "minimal",
      botId: "bot",
      channelRecord: { platform: "discord", serverId: "server" },
      pendingMessages: Array.from({ length: 6 }, (_, i) =>
        message(String(i), null, "hi"),
      ),
    },
  );
  assert.doesNotMatch(result.context[0].content, /온라인|secret game/);
});

test("member lookup ambiguity and cancellation never select an arbitrary user", async () => {
  let lookups = 0;
  const service = new ParticipantService(
    new Map([
      [
        "discord",
        {
          getStatus: async () => {
            lookups++;
            return {};
          },
          listMembers: async () => ({ profiles, source: "test" }),
        },
      ],
    ]),
  );
  const context = {
    channel: { platform: "discord" },
    participantResolver: resolver(),
  };
  assert.equal(
    (await service.getStatus({ user: "하늘" }, context)).error,
    "ambiguous",
  );
  assert.equal(lookups, 0);
  const list = await service.listMembers({}, context);
  assert.equal(list.complete, false);
  assert.ok(list.members.every((p) => !p.id));
  await assert.rejects(
    service.getStatus(
      { user: "sky" },
      { ...context, abortSignal: AbortSignal.abort() },
    ),
    /abort/i,
  );
});

test("listing new members extends the turn map while preserving names already displayed", async () => {
  const r = new ParticipantResolver([profiles[0]]);
  assert.equal(r.get("1").label, "하늘");
  const service = new ParticipantService(
    new Map([
      [
        "discord",
        {
          listMembers: async () => ({ profiles, source: "test" }),
          getStatus: async (_channel, id) =>
            profiles.find((profile) => profile.id === id),
        },
      ],
    ]),
  );
  const context = { channel: { platform: "discord" }, participantResolver: r };
  const list = await service.listMembers({}, context);
  assert.equal(list.members[0].name, "하늘");
  assert.equal(list.members[1].name, "하늘 (@sky2)");
  const status = await service.getStatus(
    { user: list.members[1].name },
    context,
  );
  assert.equal(status.username, "sky2");
  assert.equal(r.get("1").label, "하늘");
  assert.equal(r.resolve("하늘 (@sky)").profile.id, "1");
  assert.equal(r.resolve("하늘").error, "ambiguous");
});
