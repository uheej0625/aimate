import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const workspace = process.cwd();
const directory = path.join(
  workspace,
  "test",
  ".tmp",
  `chat-review-${randomUUID()}`,
);
await fs.mkdir(directory, { recursive: true });
await fs.mkdir(path.join(directory, "content", "characters"), {
  recursive: true,
});
await fs.mkdir(path.join(directory, "content", "prompts"), { recursive: true });
await fs.cp(
  path.join(workspace, "test/fixtures/character"),
  path.join(directory, "content/characters/fixture"),
  { recursive: true },
);
await fs.cp(
  path.join(workspace, "test/fixtures/prompts/minimal"),
  path.join(directory, "content/prompts/minimal"),
  { recursive: true },
);
await fs.mkdir(path.join(directory, "content/prompts/minimal/image"));
await fs.writeFile(
  path.join(directory, "content/prompts/minimal/image/photo.md"),
  "Scene={{data.scene}}",
);
process.env.DATABASE_URL = `file:${path.join(directory, "review.db").replaceAll("\\", "/")}`;
await fs.writeFile(path.join(directory, "review.db"), "");
execFileSync(
  process.execPath,
  [
    path.join(workspace, "node_modules/prisma/build/index.js"),
    "db",
    "push",
    "--skip-generate",
    "--schema",
    path.join(workspace, "prisma/schema.prisma"),
  ],
  { env: process.env, stdio: "pipe" },
);
process.chdir(directory);

const { prisma } = await import("../../src/database/client.js");
const { createContainer } = await import("../../src/core/container.js");
const { createMockClient } = await import("../../src/platforms/cli/mocks.js");
const { CLI_BOT_ID } = await import("../../src/platforms/cli/constants.js");
const { HeadlessChat } = await import("../../src/platforms/cli/headless.js");
const { PlaceholderImageGenerator } = await import(
  "../../src/review/PlaceholderImageGenerator.js"
);
const { ReviewRunner } = await import("../../src/review/ReviewRunner.js");
const { ReviewStore } = await import("../../src/review/ReviewStore.js");
const { default: photoTool } = await import(
  "../../src/tools/definitions/generatePhoto.js"
);
const { GeneratedImageAttachmentResolver } = await import(
  "../../src/messages/GeneratedImageAttachmentResolver.js"
);

test.after(async () => {
  await prisma.$disconnect();
  process.chdir(workspace);
  assert.ok(
    directory.startsWith(path.join(workspace, "test", ".tmp") + path.sep),
  );
  await fs.rm(directory, { recursive: true, force: true });
});

function config() {
  const data = {
    app: { language: "ko-KR", timezone: "Asia/Seoul" },
    character: "fixture",
    ai: {
      chat: { provider: "openai", model: "mock", prompt: "minimal" },
      image: { provider: "gateway", model: "placeholder", prompt: "minimal" },
    },
    secrets: { openaiApiKey: "mock-unused-key" },
    conversation: {
      maxContextMessages: 50,
      maxHistoryDays: 30,
      bufferTimeout: 0,
      typingDelayMin: 0,
      typingDelayMax: 0,
      typingDelayPerChar: 0,
    },
    tools: { maxSteps: 5 },
  };
  return {
    get: (key) => key.split(".").reduce((value, part) => value?.[part], data),
    getAll: () => data,
    has: (key) => !!key.split(".").reduce((value, part) => value?.[part], data),
  };
}

test("real pipeline isolates three users, persists whole responses, and resumes without duplicate delivery", async () => {
  const storePath = path.join(directory, "run");
  const store = await new ReviewStore(storePath).open({ runId: "run" });
  const inputs = [];
  const generator = {
    generate: async (context) => {
      inputs.push(JSON.stringify(context));
      const text = "# response\n\n## messages\n첫 번째[BREAK]두 번째";
      return {
        messages: ["첫 번째", "두 번째"],
        apiRequests: [
          {
            system: "private system",
            headers: { authorization: "private auth" },
          },
        ],
        apiResponses: [
          { text, steps: [], totalUsage: { inputTokens: 1, outputTokens: 2 } },
        ],
      };
    },
  };
  const manager = config();
  const client = createMockClient({ botId: CLI_BOT_ID });
  const container = await createContainer({
    configManager: manager,
    platformClients: new Map([["cli", client]]),
    chatGenerator: generator,
    imageGenerator: new PlaceholderImageGenerator(),
  });
  const chat = new HeadlessChat({
    container,
    mockClient: client,
    onDelivery: (message) => store.record({ type: "delivered", message }),
  });
  const judge = {
    initialize: async () => {},
    review: async (channel) => ({
      review: {
        nextMessage: `${channel.userName} 전용 발언 ${channel.turnCount + 1}`,
        memorySummary: "평가 정보 전송 금지",
        findings: [],
      },
    }),
  };
  await new ReviewRunner({ store, reviewer: judge, chat }).run({ maxTurns: 2 });
  assert.equal(inputs.length, 6);
  for (let index = 0; index < inputs.length; index++) {
    const ownName = store.state.channels[index % 3].userName;
    for (const channel of store.state.channels) {
      if (channel.userName !== ownName)
        assert.ok(!inputs[index].includes(`${channel.userName} 전용 발언`));
    }
    assert.ok(!inputs[index].includes("평가 정보 전송 금지"));
  }
  assert.equal(
    await prisma.platformAccount.count({
      where: { platform: "cli", platformId: { startsWith: "review-user-" } },
    }),
    3,
  );
  assert.equal(await prisma.message.count(), 18);
  assert.ok(
    store.state.channels.every((channel) =>
      channel.history.every((turn) => turn.response.messages.length === 2),
    ),
  );
  const events = await fs.readFile(
    path.join(storePath, "events.jsonl"),
    "utf8",
  );
  assert.doesNotMatch(
    events,
    /private system|private auth|authorization|apiRequest/,
  );

  // Simulate a crash after SQLite completed a turn but before the journal recorded it.
  const pending = {
    channelId: "review-1",
    number: 3,
    messageId: randomUUID(),
    userId: "review-user-1",
    userName: "지우",
    userMessage: "중단 직전 발언",
  };
  await store.record({ type: "prepared", turn: pending });
  await chat.send(pending);
  const countBefore = await prisma.message.count();
  await store.close();
  const resumed = await new ReviewStore(storePath).open({
    runId: "run",
    resume: true,
  });
  const resumedChat = new HeadlessChat({
    container,
    mockClient: client,
    onDelivery: (message) => resumed.record({ type: "delivered", message }),
  });
  await new ReviewRunner({
    store: resumed,
    reviewer: judge,
    chat: resumedChat,
  }).run({ maxTurns: 3 });
  assert.equal(await prisma.message.count(), countBefore + 6);
  assert.equal(
    await prisma.message.count({ where: { platformId: pending.messageId } }),
    1,
  );
  assert.ok(resumed.state.channels.every((channel) => channel.turnCount === 3));
  await resumed.close();
});

test("image tool renders, stores and resolves a real attachment without image AI", async () => {
  const manager = config();
  let imageCalls = 0;
  const placeholder = new PlaceholderImageGenerator();
  const originalGenerate = placeholder.generate.bind(placeholder);
  placeholder.generate = (...args) => {
    imageCalls++;
    return originalGenerate(...args);
  };
  const container = await createContainer({
    configManager: manager,
    imageGenerator: placeholder,
  });
  const channel = await prisma.channel.findFirst();
  const result = await photoTool.execute(
    { kind: "photo", scene: "카페 테이블", purpose: "친구에게 공유" },
    {
      imageGenerator: placeholder,
      configManager: manager,
      generationRepository: container.generationRepository,
      channel,
      characterId: "fixture",
    },
  );
  const generation = await container.generationRepository.findById(
    result.generationId,
  );
  assert.equal(generation.status, "COMPLETED");
  assert.match(generation.input, /카페 테이블/);
  assert.equal(JSON.parse(generation.apiResponse).imageAiCalled, false);
  assert.equal(imageCalls, 1);
  const attachment = await new GeneratedImageAttachmentResolver(
    container.generationRepository,
  ).resolve(`이거 봐 [IMAGE:${result.imageId}]`);
  assert.equal(attachment.files.length, 1);
  assert.equal(
    attachment.generatedImageAttachments[0].generationId,
    result.generationId,
  );
  const png = await fs.readFile(attachment.files[0].attachment);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  // Source-image followup still resolves the actual generated placeholder file.
  const followup = await photoTool.execute(
    { kind: "photo", scene: "다른 구도", sourceImages: [result.imageId] },
    {
      imageGenerator: placeholder,
      configManager: manager,
      generationRepository: container.generationRepository,
      channel,
      characterId: "fixture",
    },
  );
  assert.equal(followup.status, "success");
  await container.generationRepository.cancelInProgress();
});

test("failed generation waits for the fallback delivery before returning", async () => {
  const manager = config();
  const client = createMockClient({ botId: CLI_BOT_ID });
  const container = await createContainer({
    configManager: manager,
    imageGenerator: new PlaceholderImageGenerator(),
    chatGenerator: {
      generate: async () => {
        throw new Error("mock failure");
      },
    },
  });
  const chat = new HeadlessChat({ container, mockClient: client });
  await chat.initialize([{ id: "failure-channel" }]);
  const result = await chat.send({
    channelId: "failure-channel",
    messageId: randomUUID(),
    userMessage: "테스트",
    userId: "failure-user",
    userName: "테스터",
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].content, /오류/);
  await chat.close();
});

test("manual abort cancels the real pipeline and cannot send late messages", async () => {
  const manager = config();
  const client = createMockClient({ botId: CLI_BOT_ID });
  let started;
  const begin = new Promise((resolve) => {
    started = resolve;
  });
  const container = await createContainer({
    configManager: manager,
    imageGenerator: new PlaceholderImageGenerator(),
    chatGenerator: {
      generate: async (
        _context,
        _system,
        _platform,
        _channel,
        { abortSignal },
      ) => {
        started();
        return new Promise((_, reject) =>
          abortSignal.addEventListener(
            "abort",
            () => reject(abortSignal.reason),
            { once: true },
          ),
        );
      },
    },
  });
  const chat = new HeadlessChat({ container, mockClient: client });
  await chat.initialize([{ id: "abort-channel" }]);
  const controller = new AbortController();
  const pending = {
    channelId: "abort-channel",
    messageId: randomUUID(),
    userMessage: "중지",
    userId: "abort-user",
    userName: "테스터",
  };
  const call = chat.send(pending, { signal: controller.signal });
  await begin;
  controller.abort(new DOMException("stop", "AbortError"));
  await assert.rejects(call, { name: "AbortError" });
  await chat.close();
  const saved = await chat.recover(pending);
  assert.equal(saved.status, "CANCELLED");
  assert.equal(saved.messages.length, 0);
});
