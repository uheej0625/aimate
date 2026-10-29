import test from "node:test";
import assert from "node:assert/strict";
import { ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import command from "../../../src/platforms/discord/commands/log.js";
import { DiscordLogService } from "../../../src/platforms/discord/logging/DiscordLogService.js";
import {
  buildLogEmbed,
  buildLogFiles,
  buildLogButtons,
  apiTexts,
} from "../../../src/platforms/discord/logging/logEmbeds.js";
import interactionEvent from "../../../src/platforms/discord/events/interactionCreate.js";
import { AppEvents, EventBus } from "../../../src/core/EventBus.js";
import { captureLogs } from "../../helpers/logs.js";

const source = {
  id: "internal",
  platform: "discord",
  platformId: "conversation",
  server: { platformId: "guild" },
};
const generation = {
  id: 12,
  channelId: "internal",
  type: "CHAT",
  status: "PROCESSING",
  characterId: "fixture",
  createdAt: new Date("2026-10-27T00:00:00Z"),
  updatedAt: new Date("2026-10-27T00:00:03Z"),
};
const storedResponse = (text) =>
  JSON.stringify({
    response: {
      messages: [{ role: "assistant", content: [{ type: "text", text }] }],
    },
  });
const inputSnapshot = (events) =>
  JSON.stringify({
    eventSnapshot: { events, inputEventIds: events.map((event) => event.id) },
  });
const observed = (id, content) => ({
  id,
  channelMessageNo: id,
  kind: "READ",
  snapshotContent: content,
  observedAt: new Date(generation.createdAt.getTime() + id),
});

function harness() {
  const records = { generations: [], pending: [] };
  const sent = [];
  const edited = [];
  const bus = new EventBus();
  const conversationBuffer = { buffers: new Map() };
  const subscriptions = new Map();
  const repository = {
    configure: ({ guildId, channelId, enabled }) => {
      const key = JSON.stringify([guildId, channelId]);
      if (enabled) subscriptions.set(key, { guildId, channelId });
      else subscriptions.delete(key);
    },
    destinations: async () => [...subscriptions.values()],
    sourceChannel: async () => source,
    pendingEvents: async () => records.pending,
    generation: async (id, guildId) =>
      records.generations.find(
        (record) =>
          record.id === id && record.channel.server.platformId === guildId,
      ),
    changes: async ({ since, guildIds }) =>
      records.generations.filter(
        (record) =>
          record.channel.platform === "discord" &&
          guildIds.includes(record.channel.server.platformId) &&
          record.updatedAt >= since,
      ),
  };
  const channel = {
    id: "logs",
    guildId: "guild",
    isSendable: () => true,
    send: async (payload) => {
      sent.push(payload);
      return { id: "log-" + sent.length };
    },
    messages: { edit: async (id, payload) => edited.push({ id, payload }) },
  };
  const client = { channels: { fetch: async () => channel } };
  const makeService = () => {
    const service = new DiscordLogService({
      client,
      repository,
      eventBus: bus,
      conversationBuffer,
      configManager: {
        get: (key) => (key === "character" ? "fixture" : "minimal"),
      },
    });
    service.start();
    return service;
  };
  const service = makeService();
  service.configure({
    guildId: "guild",
    channelId: "logs",
    enabled: true,
  });
  let clock = Date.now();
  const emit = async (status, overrides = {}) => {
    clock = Math.max(clock + 1, Date.now() + 1);
    const record = {
      ...generation,
      createdAt: new Date(clock),
      ...overrides,
      status,
      updatedAt: new Date(clock),
      channel: source,
    };
    records.generations = [record];
    const event = {
      PROCESSING: AppEvents.GenerationStarted,
      COMPLETED: AppEvents.GenerationCompleted,
      CANCELLED: AppEvents.GenerationCancelled,
      FAILED: AppEvents.GenerationFailed,
    }[status];
    if (event) await bus.emitAsync(event, { generation: record });
  };
  return {
    service,
    makeService,
    emit,
    records,
    get subscriptions() {
      return [...subscriptions.values()];
    },
    channel,
    sent,
    edited,
    repository,
    bus,
    conversationBuffer,
  };
}

test("generation cards update in place and unchanged rows do not cause repeated edits", async () => {
  const h = harness();
  await h.emit("PROCESSING");
  await h.service.flush();
  await h.emit("GENERATED", { apiResponse: storedResponse("hello") });
  await h.service.refresh();
  await h.service.refresh();
  await h.emit("COMPLETED", {
    apiResponse: storedResponse("hello"),
    sentAt: new Date(),
  });
  await h.service.close();
  assert.equal(h.sent.length, 1);
  assert.deepEqual(
    h.edited.map((edit) => edit.id),
    ["log-1", "log-1"],
  );
  assert.match(h.edited.at(-1).payload.embeds[0].data.title, /완료/);
  assert.deepEqual(h.sent[0].allowedMentions, { parse: [] });
  const restarted = h.makeService();
  await h.emit("COMPLETED");
  await restarted.flush();
  await restarted.close();
  assert.equal(
    h.sent.length,
    2,
    "Restarting keeps configured destinations but resets card IDs",
  );
  await restarted.configure({
    guildId: "guild",
    channelId: "logs",
    enabled: false,
  });
  const changes = h.repository.changes;
  h.repository.changes = () =>
    assert.fail("Disabled logging must not query generations");
  const disabled = h.makeService();
  await disabled.refresh();
  await disabled.close();
  h.repository.changes = changes;
  assert.equal(
    h.sent.length,
    2,
    "Disabling remains effective after restarting",
  );
});

test("deleted log cards are recreated; permissions errors do not create duplicates", async (t) => {
  captureLogs(t);
  const h = harness();
  await h.emit("PROCESSING");
  await h.service.flush();
  h.channel.messages.edit = async () => {
    throw Object.assign(new Error("deleted"), { code: 10008 });
  };
  await h.emit("GENERATED");
  await h.service.refresh();
  assert.equal(h.sent.length, 2);
  h.channel.messages.edit = async () => {
    throw Object.assign(new Error("denied"), { code: 50013 });
  };
  await h.emit("COMPLETED");
  await h.service.close();
  assert.equal(h.sent.length, 2);
});

test("subscriptions are configured per channel and records stay within their guild", async () => {
  const h = harness();
  await h.service.configure({
    guildId: "guild",
    channelId: "second-log",
    enabled: true,
  });
  await h.service.configure({
    guildId: "guild",
    channelId: "logs",
    enabled: false,
  });
  assert.deepEqual(h.subscriptions, [
    { guildId: "guild", channelId: "second-log" },
  ]);
  await h.service.configure({
    guildId: "guild",
    channelId: "second-log",
    enabled: false,
  });
  await h.service.configure({
    guildId: "another-guild",
    channelId: "private-logs",
    enabled: true,
  });
  await h.emit("PROCESSING");
  await h.service.close();
  assert.equal(h.sent.length, 0);
});

test("slow or failed log refresh never blocks generation events", async (t) => {
  captureLogs(t);
  const h = harness();
  let release;
  h.channel.send = async () =>
    await new Promise((resolve) => {
      release = resolve;
    });
  await h.emit("PROCESSING");
  while (!release) await new Promise(setImmediate);
  await h.emit("FAILED");
  release({ id: "slow-log" });
  await h.service.flush();
  await h.service.refresh();
  assert.equal(h.edited[0].id, "slow-log");
  const changes = h.repository.changes;
  h.repository.changes = async () => {
    throw new Error("database unavailable");
  };
  await h.emit("FAILED");
  await h.service.flush();
  h.repository.changes = changes;
  await h.emit("CANCELLED");
  await h.service.close();
  assert.match(h.edited.at(-1).payload.embeds[0].data.title, /취소/);
});

test("incoming messages accumulate in one waiting card across buffer turns and become the real generation card", async () => {
  const h = harness();
  const key = JSON.stringify(["discord", "conversation"]);
  h.records.pending = [observed(1, "first[BREAK]message")];
  h.conversationBuffer.buffers.set(key, { turnId: "first-turn" });
  await h.service.refresh();
  assert.equal(h.records.generations.length, 0);
  assert.match(h.sent[0].embeds[0].data.title, /대기/);
  assert.equal(
    h.sent[0].embeds[0].data.fields.find((item) => item.name === "프롬프트")
      .value,
    "minimal",
  );
  const request = (payload) =>
    payload.embeds[0].data.fields.find((item) => item.name === "요청").value;
  assert.equal(request(h.sent[0]), '#1 [메시지] "first[BREAK]message"');
  h.records.pending.push(observed(2, "  second message  "));
  h.conversationBuffer.buffers.set(key, { turnId: "replacement-turn" });
  await h.service.refresh();
  assert.equal(h.sent.length, 1);
  assert.equal(h.edited[0].id, "log-1");
  assert.match(h.edited[0].payload.embeds[0].data.title, /대기/);
  assert.equal(
    request(h.edited[0].payload),
    '#1 [메시지] "first[BREAK]message"\n#2 [메시지] "  second message  "',
  );
  h.records.pending.push(observed(3, "third"));
  h.conversationBuffer.buffers.set(key, { turnId: "third-turn" });
  await h.service.refresh();
  await h.service.refresh();
  assert.equal(h.sent.length, 1);
  assert.equal(h.edited.length, 2, "Unchanged batches do not trigger edits");
  assert.equal(
    request(h.edited.at(-1).payload),
    '#1 [메시지] "first[BREAK]message"\n#2 [메시지] "  second message  "\n#3 [메시지] "third"',
  );
  h.conversationBuffer.buffers.delete(key);
  await h.emit("PROCESSING");
  await h.service.flush();
  assert.equal(h.sent.length, 1);
  assert.equal(h.edited.at(-1).id, "log-1");
  assert.match(h.edited.at(-1).payload.embeds[0].data.title, /생성 중/);
  assert.ok(request(h.edited.at(-1).payload).includes("third"));
  const input = inputSnapshot(h.records.pending);
  await h.emit("COMPLETED", {
    input,
    apiResponse: storedResponse("reply[BREAK]done"),
  });
  await h.service.flush();
  h.records.pending = [observed(4, "next batch")];
  h.conversationBuffer.buffers.set(key, { turnId: "second-turn" });
  await h.service.refresh();
  assert.equal(h.sent.length, 2);
  assert.equal(request(h.sent[1]), '#4 [메시지] "next batch"');
  h.conversationBuffer.buffers.delete(key);
  await h.service.close();
  assert.equal(h.edited.at(-1).id, "log-2");
  assert.match(h.edited.at(-1).payload.embeds[0].data.title, /취소/);
});

test("request observations keep message numbers and chronological edits and deletions on single lines", () => {
  const first = {
    ...observed(1, "  first[BREAK]line\nnext  "),
    channelMessageNo: 40,
  };
  const second = { ...observed(2, "second"), channelMessageNo: 41 };
  const edit = {
    ...observed(3, "updated"),
    channelMessageNo: 40,
    kind: "EDIT",
    previousContent: first.snapshotContent,
  };
  const deletion = {
    ...observed(4, "second"),
    channelMessageNo: 41,
    kind: "DELETE",
  };
  const events = [deletion, second, edit, first];
  const input = inputSnapshot(events);
  const record = { ...generation, input };
  const request = buildLogEmbed(record, source).data.fields.find(
    (item) => item.name === "요청",
  ).value;
  assert.equal(
    request,
    [
      '#40 [메시지] "  first[BREAK]line\\\\nnext  "',
      '#41 [메시지] "second"',
      '#40 [수정] "  first[BREAK]line\\\\nnext  " → "updated"',
      '#41 [삭제] "second"',
    ].join("\n"),
  );
  assert.equal(request.split("\n").length, 4);
  assert.equal(
    record.input,
    input,
    "Log formatting must not rewrite the stored model input",
  );
  assert.equal(
    events[0],
    deletion,
    "Sorting the view must not reorder the snapshot",
  );
  const excluded = buildLogEmbed(
    {
      ...record,
      input: JSON.stringify({
        eventSnapshot: { events, inputEventIds: [edit.id, deletion.id] },
      }),
    },
    source,
  ).data.fields.find((item) => item.name === "요청").value;
  assert.equal(excluded.split("\n").length, 2);
  assert.match(excluded, /^#40 \[수정\]/);
});

test("polling observes image generations and updates the same card", async () => {
  const h = harness();
  await h.emit("GENERATED", {
    type: "IMAGE",
    input: "image prompt",
    output: "image.png",
  });
  await h.service.refresh();
  await h.service.refresh();
  assert.equal(h.sent.length, 1);
  assert.equal(h.edited.length, 0);
  await h.emit("COMPLETED", {
    type: "IMAGE",
    input: "image prompt",
    output: "image.png",
  });
  await h.service.close();
  assert.equal(h.sent.length, 1);
  assert.equal(h.edited[0].id, "log-1");
  assert.match(h.edited[0].payload.embeds[0].data.title, /완료.*IMAGE/);
});

test("pipeline distinguishes debounce, generation and paced delivery and keeps completed timings after discard", () => {
  const started = new Date("2026-10-29T00:00:05.000Z");
  const input = inputSnapshot([
    { ...observed(1, "hello"), observedAt: "2026-10-29T00:00:00.000Z" },
  ]);
  const record = {
    ...generation,
    createdAt: started,
    updatedAt: new Date("2026-10-30T00:00:00Z"),
    status: "COMPLETED",
    input,
    discardedAt: new Date("2026-10-30T00:00:00Z"),
    metadata: JSON.stringify({
      timings: {
        generatedAt: "2026-10-29T00:00:08.100Z",
        completedAt: "2026-10-29T00:00:09.500Z",
      },
    }),
  };
  const embed = buildLogEmbed(record, source).toJSON();
  assert.equal(
    embed.description,
    "▰ 대기 5.0s  ›  ▰ 생성 3.1s  ›  ▰ 전송 1.4s",
  );
  assert.equal(
    embed.fields.find((item) => item.name === "소요 시간").value,
    "9.5s",
  );
  assert.equal(
    embed.fields.find((item) => item.name === "시작").value,
    "<t:1793232000:T>",
  );
  const active = buildLogEmbed(
    {
      ...record,
      status: "GENERATED",
      metadata: JSON.stringify({
        timings: { generatedAt: "2026-10-29T00:00:08.100Z" },
      }),
    },
    source,
  ).toJSON();
  assert.match(active.description, /생성 3.1s.*전송 진행 중/);
  assert.ok(!active.fields.some((item) => item.name === "소요 시간"));
  const missing = buildLogEmbed(
    { ...record, metadata: null, discardedAt: null },
    source,
  ).toJSON();
  assert.match(
    missing.description,
    /생성 —.*전송 —/,
    "Missing stage boundaries must not be invented",
  );
});

test("technical fields summarize models, aggregate usage once per call, and list actual tools", () => {
  const record = {
    ...generation,
    apiRequest: JSON.stringify({
      provider: "gateway",
      model: "configured-model",
      system: "secret prompt",
    }),
    apiResponse: JSON.stringify([
      {
        response: { modelId: "actual-model" },
        totalUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        usage: { inputTokens: 999, outputTokens: 999, totalTokens: 1998 },
        steps: [
          {
            model: { modelId: "actual-model", provider: "openai.responses" },
            usage: { inputTokens: 999 },
            toolCalls: [
              { toolName: "generate_photo", input: { prompt: "one" } },
              { toolName: "generate_photo", input: { prompt: "two" } },
            ],
          },
        ],
      },
      {
        usage: { inputTokens: 4, outputTokens: 6 },
        recoveredTextToolCall: { toolName: "reply" },
      },
    ]),
  };
  const embed = buildLogEmbed(record, source).toJSON();
  assert.equal(
    embed.fields.find((item) => item.name === "모델").value,
    "actual-model",
  );
  assert.equal(
    embed.fields.find((item) => item.name === "토큰 · usage").value,
    "입력 104 · 출력 26 · 합계 130",
  );
  assert.equal(
    embed.fields.find((item) => item.name === "도구 호출").value,
    'generate\\_photo({"prompt":"one"})\ngenerate\\_photo({"prompt":"two"})\nreply()',
  );
  assert.equal(
    embed.fields.find((item) => item.name === "Provider").value,
    "openai.responses · gateway",
  );
  const toolOnly = buildLogEmbed(
    {
      ...generation,
      apiResponse: JSON.stringify({
        response: {
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolName: "react",
                  input: { emoji: "👍" },
                },
              ],
            },
          ],
        },
      }),
    },
    source,
  ).toJSON();
  assert.equal(
    toolOnly.fields.find((item) => item.name === "도구 호출").value,
    'react({"emoji":"👍"})',
  );
  assert.doesNotMatch(JSON.stringify(embed), /secret prompt|configured-model/);
  assert.equal(
    buildLogEmbed(
      { ...generation, apiRequest: record.apiRequest },
      source,
    ).data.fields.find((item) => item.name === "모델").value,
    "configured-model",
  );
});

test("API buttons always send only a private txt attachment for requests and responses and enforce guild scope", async () => {
  const h = harness();
  const raw = "  ## messages\n" + "가😀[BREAK]나\n".repeat(410) + "  ";
  const apiRequest = {
    provider: "openai",
    model: "test-model",
    system: "fixture system ".repeat(300),
    messages: [{ role: "user", content: "entire history[BREAK]" }],
    tools: ["generate_photo"],
  };
  const requests = [
    {
      body: JSON.stringify({
        tools: [{ name: "generate_photo", parameters: { type: "object" } }],
        input: "full first call",
      }),
    },
    { body: '{"input":"second call including tool result"}' },
  ];
  const apiResponse = [
    {
      ...JSON.parse(storedResponse(raw)),
      request: requests[1],
      steps: requests.map((request, stepNumber) => ({
        request,
        stepNumber,
        toolCalls: [
          {
            toolName: "generate_photo",
            input: { prompt: `photo-${stepNumber}` },
          },
        ],
        toolResults: [
          { toolName: "generate_photo", output: { success: true } },
        ],
      })),
      usage: { inputTokens: 10, outputTokens: 20 },
    },
    { finishReason: "stop", response: { modelId: "second-model" } },
  ];
  await h.emit("COMPLETED", {
    input: inputSnapshot([observed(1, "question[BREAK]raw")]),
    apiRequest: JSON.stringify(apiRequest),
    apiResponse: JSON.stringify(apiResponse),
  });
  await h.service.flush();
  const buttons = h.sent[0].components[0].toJSON().components;
  assert.equal(buttons.length, 2);
  assert.deepEqual(
    buttons.map((item) => item.custom_id),
    ["aimate-log:request:12", "aimate-log:response:12"],
  );
  assert.ok(buttons.every((item) => item.disabled === false));
  const pendingButtons = buildLogButtons({
    ...generation,
    id: "waiting:turn",
    status: "PENDING",
  })[0].toJSON().components;
  assert.ok(pendingButtons.every((item) => item.disabled));
  const replies = [];
  const click = (type, guildId = "guild") => ({
    customId: `aimate-log:${type}:12`,
    guildId,
    isButton: () => true,
    deferReply: async (payload) =>
      assert.deepEqual(payload, { flags: MessageFlags.Ephemeral }),
    editReply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  });
  await interactionEvent.execute(click("response"), {
    client: { commands: new Map() },
    discordLogService: h.service,
  });
  assert.equal(replies.length, 1, "Long originals must be a single file reply");
  assert.deepEqual(Object.keys(replies[0]), ["files"]);
  assert.equal(replies[0].files[0].name, "generation-12-api-response.txt");
  assert.deepEqual(
    JSON.parse(replies[0].files[0].attachment.toString("utf8")),
    apiResponse,
  );
  replies.length = 0;
  await h.service.showOriginal(click("request"));
  const exportedRequest = JSON.parse(
    replies[0].files[0].attachment.toString("utf8"),
  );
  assert.equal(replies.length, 1);
  assert.deepEqual(Object.keys(replies[0]), ["files"]);
  assert.equal(replies[0].files[0].name, "generation-12-api-request.txt");
  assert.deepEqual(exportedRequest.apiRequest, apiRequest);
  assert.deepEqual(
    exportedRequest.requests.map((entry) => entry.request),
    requests,
  );
  assert.deepEqual(
    exportedRequest.requests.map((entry) => [entry.call, entry.step]),
    [
      [1, 0],
      [1, 1],
    ],
  );
  assert.equal(
    buildLogButtons({
      ...generation,
      apiResponse: JSON.stringify({ request: requests[0] }),
    })[0].toJSON().components[0].disabled,
    false,
    "SDK request bodies are available even without initial request metadata",
  );
  const short = {
    usage: { inputTokens: 1 },
    steps: [{ toolCalls: [{ toolName: "react", input: { emoji: "👍" } }] }],
  };
  h.records.generations[0].apiResponse = JSON.stringify(short);
  replies.length = 0;
  await h.service.showOriginal(click("response"));
  assert.deepEqual(Object.keys(replies[0]), ["files"]);
  assert.deepEqual(
    JSON.parse(replies[0].files[0].attachment.toString("utf8")),
    short,
  );
  h.records.generations[0].apiRequest = JSON.stringify({
    provider: "openai",
    messages: [],
  });
  replies.length = 0;
  await h.service.showOriginal(click("request"));
  assert.deepEqual(Object.keys(replies[0]), ["files"]);
  assert.deepEqual(
    JSON.parse(replies[0].files[0].attachment.toString("utf8")).apiRequest,
    { provider: "openai", messages: [] },
  );
  assert.deepEqual(
    JSON.parse(
      apiTexts({
        ...generation,
        apiResponse: JSON.stringify({ request: requests[0] }),
      }).request,
    ).requests[0].request,
    requests[0],
  );
  replies.length = 0;
  await h.service.showOriginal(click("response", "another-guild"));
  assert.match(replies[0].content, /찾을 수 없/);
  assert.doesNotMatch(replies[0].content, /BREAK/);
  await h.service.close();
});

test("embeds fit Discord limits, escape user markdown, and omit API details", () => {
  const record = {
    ...generation,
    input: "private image prompt",
    apiRequest: "secret request",
    apiResponse: "secret response",
    type: "IMAGE",
    status: "FAILED",
  };
  const image = buildLogEmbed(record, source).toJSON();
  assert.doesNotMatch(JSON.stringify(image), /secret request|secret response/);
  assert.equal(
    image.fields.find((item) => item.name === "요청").value,
    "private image prompt",
  );
  const embed = buildLogEmbed(
    { ...record, input: "**bold**".repeat(2000), output: "y".repeat(9000) },
    source,
  ).toJSON();
  assert.ok(embed.fields.every((item) => item.value.length <= 1024));
  assert.ok(
    embed.fields.reduce(
      (sum, item) => sum + item.name.length + item.value.length,
      0,
    ) < 5500,
  );
  assert.match(embed.fields.find((item) => item.name === "요청").value, /\\\*/);
});

test("Generation shows its prompt while pending and preserves original request and response including BREAK", () => {
  const pending = buildLogEmbed(
    { ...generation, status: "PENDING", prompt: "minimal" },
    source,
  ).toJSON();
  assert.equal(
    pending.fields.find((item) => item.name === "프롬프트").value,
    "minimal",
  );
  assert.equal(
    pending.fields.find((item) => item.name === "요청").value,
    "입력 준비 중",
  );
  assert.equal(
    pending.fields.find((item) => item.name === "응답").value,
    "응답 대기 중",
  );
  const raw = "  ## messages\nfirst[BREAK]  second\n\n## state\nraw state  ";
  const record = {
    ...generation,
    prompt: "minimal",
    input: JSON.stringify({
      messages: [{ content: "question[BREAK]as typed" }],
    }),
    output: '["first","second"]',
    apiResponse: storedResponse(raw),
  };
  const embed = buildLogEmbed(record, source).toJSON();
  const request = embed.fields.find((item) => item.name === "요청").value;
  const response = embed.fields.find((item) => item.name === "응답").value;
  assert.equal(request, "question[BREAK]as typed");
  assert.ok(response.includes("first[BREAK]  second"));
  assert.ok(response.startsWith("  "));
  assert.ok(response.endsWith("  "));
  assert.ok(
    !embed.fields.some(
      (item) => item.name === "입력" || item.name === "응답 미리보기",
    ),
  );
  assert.deepEqual(buildLogFiles(record), []);
});

test("an empty final SDK step does not show text from an earlier tool step", () => {
  const messages = [
    {
      role: "assistant",
      content: [{ type: "text", text: "earlier tool step" }],
    },
  ];
  const apiResponse = JSON.stringify({
    response: { messages },
    steps: [{ response: { messages } }, { response: { messages } }],
  });
  const embed = buildLogEmbed(
    { ...generation, status: "COMPLETED", apiResponse },
    source,
  ).toJSON();
  assert.equal(
    embed.fields.find((item) => item.name === "응답").value,
    "(빈 원문)",
  );
});

test("long originals are attached losslessly and edits replace old attachments", async () => {
  const raw = `  ${"가[BREAK]나\n".repeat(400)}  `;
  const record = {
    ...generation,
    input: JSON.stringify({ messages: [{ content: raw }] }),
    apiResponse: storedResponse(raw),
  };
  const files = buildLogFiles(record);
  assert.deepEqual(
    files.map((file) => file.name),
    ["generation-12-request.txt", "generation-12-response.txt"],
  );
  assert.ok(files.every((file) => file.attachment.toString("utf8") === raw));
  const embed = buildLogEmbed(record, source).toJSON();
  assert.ok(embed.fields.every((item) => item.value.length <= 1024));
  const h = harness();
  await h.emit("GENERATED", record);
  await h.service.refresh();
  assert.equal(h.sent[0].files.length, 2);
  h.channel.messages.edit = async (_id, payload) => {
    // discord.js appends file descriptors to the supplied attachment array.
    payload.attachments.push({ id: "0", filename: "stale" });
    throw Object.assign(new Error("deleted card"), { code: 10008 });
  };
  await h.emit("GENERATED", record);
  await h.service.refresh();
  assert.deepEqual(h.sent[1].attachments, []);
  assert.equal(h.sent[1].files.length, 2);
  h.channel.messages.edit = async (id, payload) =>
    h.edited.push({ id, payload });
  await h.emit("COMPLETED", {
    apiResponse: storedResponse("short[BREAK]response"),
  });
  await h.service.close();
  assert.deepEqual(h.edited[0].payload.attachments, []);
  assert.deepEqual(h.edited[0].payload.files, []);
});

function interaction({
  permitted = true,
  botPermitted = true,
  enabled = true,
  target = null,
} = {}) {
  const replies = [];
  const channel = {
    id: "logs",
    guildId: "guild",
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has: () => botPermitted }),
  };
  return {
    replies,
    channel,
    guildId: "guild",
    memberPermissions: { has: () => permitted },
    client: { user: { id: "bot" } },
    options: {
      getChannel: () => target,
      getString: (name) => {
        assert.equal(name, "상태");
        return enabled ? "enable" : "disable";
      },
    },
    deferReply: async (payload) => {
      assert.equal(payload.flags, MessageFlags.Ephemeral);
    },
    editReply: async (payload) => replies.push(payload),
  };
}

test("log command is guild-only, requires server management, and defaults to the current channel", async () => {
  const schema = command.data.toJSON();
  assert.equal(
    schema.default_member_permissions,
    String(PermissionFlagsBits.ManageGuild),
  );
  assert.deepEqual(schema.contexts, [0]);
  assert.equal(schema.options[0].name, "채널");
  assert.deepEqual(
    schema.options[0].options.map((option) => option.name),
    ["상태", "대상"],
  );
  const calls = [];
  const dependencies = {
    discordLogService: {
      configure: (request) => {
        calls.push(request);
      },
    },
  };
  const allowed = interaction();
  await command.execute(allowed, dependencies);
  assert.deepEqual(calls[0], {
    guildId: "guild",
    channelId: "logs",
    enabled: true,
  });
  assert.match(allowed.replies[0].embeds[0].data.title, /연결/);
  for (const options of [
    { permitted: false },
    { botPermitted: false },
    { target: { id: "foreign", guildId: "other" } },
  ]) {
    await command.execute(interaction(options), dependencies);
  }
  assert.equal(calls.length, 1);
  await command.execute(
    interaction({ botPermitted: false, enabled: false }),
    dependencies,
  );
  assert.equal(calls[1].enabled, false);
});
