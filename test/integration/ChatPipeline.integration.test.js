import test from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const workspaceRoot = process.cwd();
const tempDir = path.join(workspaceRoot, "test", ".tmp");
const databaseFilename = `chat-pipeline-${randomUUID()}.db`;
const databasePath = path.join(tempDir, databaseFilename);
const databaseUrl = `file:../test/.tmp/${databaseFilename}`;
const prismaCliPath = path.join(
  workspaceRoot,
  "node_modules",
  "prisma",
  "build",
  "index.js",
);

await fs.mkdir(tempDir, { recursive: true });
await fs.writeFile(databasePath, "");
execFileSync(
  process.execPath,
  [
    prismaCliPath,
    "db",
    "push",
    "--skip-generate",
    "--schema",
    "prisma/schema.prisma",
  ],
  {
    cwd: workspaceRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  },
);
process.env.DATABASE_URL = databaseUrl;

const { prisma } = await import("../../src/database/client.js");
const { UserRepository } = await import(
  "../../src/repositories/UserRepository.js"
);
const { PlatformAccountRepository } = await import(
  "../../src/repositories/PlatformAccountRepository.js"
);
const { ChannelRepository } = await import(
  "../../src/repositories/ChannelRepository.js"
);
const { ServerRepository } = await import(
  "../../src/repositories/ServerRepository.js"
);
const { MessageRepository } = await import(
  "../../src/repositories/MessageRepository.js"
);
const { GenerationRepository } = await import(
  "../../src/repositories/GenerationRepository.js"
);
const { MessageService } = await import("../../src/messages/MessageService.js");
const { MessageSender } = await import("../../src/messages/MessageSender.js");
const { HistoryService } = await import("../../src/messages/HistoryService.js");
const { HistoryMessageFormatter } = await import(
  "../../src/messages/HistoryMessageFormatter.js"
);
const { CharacterContextBuilder } = await import(
  "../../src/character/CharacterContextBuilder.js"
);
const { PromptComposer } = await import(
  "../../src/chat/context/PromptComposer.js"
);
const { SequenceBuilder } = await import(
  "../../src/chat/context/SequenceBuilder.js"
);
const { ChatContextPreparer } = await import(
  "../../src/chat/context/ChatContextPreparer.js"
);
const { ChatGenerator } = await import("../../src/ai/ChatGenerator.js");
const { ChatFlow } = await import("../../src/chat/ChatFlow.js");
const { ChatGenerationLifecycle } = await import(
  "../../src/chat/ChatGenerationLifecycle.js"
);
const { ChatGenerationFailureHandler } = await import(
  "../../src/chat/ChatGenerationFailureHandler.js"
);
const { ChatGenerationAbortRegistry } = await import(
  "../../src/chat/ChatGenerationAbortRegistry.js"
);
const { AppEvents, EventBus } = await import("../../src/core/EventBus.js");
const { createMockChannel, createMockClient } = await import(
  "../../src/platforms/cli/mocks.js"
);
const { adaptMessageData } = await import("../../src/platforms/cli/adapter.js");

test.after(async () => {
  await prisma.$disconnect();
  await fs.rm(databasePath, { force: true });
  await fs.rm(`${databasePath}-journal`, { force: true });
  await fs.rm(`${databasePath}-wal`, { force: true });
  await fs.rm(`${databasePath}-shm`, { force: true });
});

test("chat pipeline persists history and multiple model-free replies", async () => {
  const modelRequests = [];
  const responses = [
    "# response\n\n## messages\n첫 답장 [BREAK] 두 번째 답장",
    "# response\n\n## messages\n이전 대화도 기억해",
  ];
  const harness = createHarness({
    generateTextFn: async (request) => {
      modelRequests.push(request);
      return fakeTextResult(responses.shift());
    },
  });

  const firstInput = createUserMessage(harness, {
    id: `user-message-${randomUUID()}`,
    content: "안녕",
  });
  await harness.messageService.saveMessage(firstInput);
  await harness.messageService.saveMessage(firstInput);
  await harness.chatFlow.execute({
    channel: harness.channel,
    botId: harness.botId,
  });

  assert.deepStrictEqual(harness.sentMessages, ["첫 답장", "두 번째 답장"]);
  assert.match(modelRequests[0].system, /Fixture Character/);
  assert.ok(
    modelRequests[0].messages.some(({ content }) => content === "안녕"),
  );

  const secondInput = createUserMessage(harness, {
    id: `user-message-${randomUUID()}`,
    content: "아까 뭐라고 했지?",
  });
  await harness.messageService.saveMessage(secondInput);
  await harness.chatFlow.execute({
    channel: harness.channel,
    botId: harness.botId,
  });

  assert.deepStrictEqual(harness.sentMessages, [
    "첫 답장",
    "두 번째 답장",
    "이전 대화도 기억해",
  ]);
  assert.ok(
    modelRequests[1].messages.some(({ content }) => content === "첫 답장"),
  );
  assert.ok(
    modelRequests[1].messages.some(
      ({ content }) => content === "아까 뭐라고 했지?",
    ),
  );

  const channel = await prisma.channel.findUnique({
    where: {
      platform_platformId: {
        platform: "cli",
        platformId: harness.channel.platformChannelId,
      },
    },
  });
  const generations = await prisma.generation.findMany({
    where: { channelId: channel.id },
    orderBy: { id: "asc" },
  });
  const messages = await prisma.message.findMany({
    where: { channelId: channel.id },
    orderBy: { id: "asc" },
  });

  assert.strictEqual(generations.length, 2);
  assert.ok(generations.every(({ characterId }) => characterId === "fixture"));
  assert.ok(generations.every(({ status }) => status === "COMPLETED"));
  assert.ok(
    generations.every(
      ({ apiRequest, apiResponse }) => apiRequest && apiResponse,
    ),
  );
  assert.deepStrictEqual(JSON.parse(generations[0].output), [
    "첫 답장",
    "두 번째 답장",
  ]);
  assert.deepStrictEqual(JSON.parse(generations[1].output), [
    "이전 대화도 기억해",
  ]);
  assert.strictEqual(messages.length, 5);
  assert.strictEqual(
    messages.filter(
      ({ platformId }) => platformId === firstInput.platformMessageId,
    ).length,
    1,
  );
  assert.ok(messages.every(({ generationId }) => generationId !== null));
});

test("chat pipeline marks a failed model call and sends a fallback", async () => {
  const harness = createHarness({
    generateTextFn: async () => {
      throw new Error("synthetic model failure");
    },
  });
  const input = createUserMessage(harness, {
    id: `failed-user-message-${randomUUID()}`,
    content: "실패 테스트",
  });
  await harness.messageService.saveMessage(input);

  await harness.chatFlow.execute({
    channel: harness.channel,
    botId: harness.botId,
  });

  const channel = await prisma.channel.findUnique({
    where: {
      platform_platformId: {
        platform: "cli",
        platformId: harness.channel.platformChannelId,
      },
    },
  });
  const generation = await prisma.generation.findFirst({
    where: { channelId: channel.id },
    orderBy: { id: "desc" },
  });

  assert.strictEqual(generation.status, "FAILED");
  assert.strictEqual(generation.output, null);
  assert.strictEqual(harness.sentMessages.length, 1);
  assert.match(harness.sentMessages[0], /답변 생성 중 오류/);
});

test("chat pipeline preserves cancellation before the model call", async () => {
  let modelCalled = false;
  const harness = createHarness({
    generateTextFn: async () => {
      modelCalled = true;
      return fakeTextResult("## messages\n호출되면 안 됨");
    },
  });
  harness.eventBus.on(AppEvents.GenerationStarted, async ({ generation }) => {
    await harness.generationRepository.updateStatus(generation.id, "CANCELLED");
  });
  const input = createUserMessage(harness, {
    id: `cancelled-user-message-${randomUUID()}`,
    content: "취소 테스트",
  });
  await harness.messageService.saveMessage(input);

  await harness.chatFlow.execute({
    channel: harness.channel,
    botId: harness.botId,
  });

  const channel = await prisma.channel.findUnique({
    where: {
      platform_platformId: {
        platform: "cli",
        platformId: harness.channel.platformChannelId,
      },
    },
  });
  const generation = await prisma.generation.findFirst({
    where: { channelId: channel.id },
    orderBy: { id: "desc" },
  });

  assert.strictEqual(modelCalled, false);
  assert.strictEqual(generation.status, "CANCELLED");
  assert.deepStrictEqual(harness.sentMessages, []);
});

test("chat pipeline aborts an in-flight generation when interrupted", async () => {
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let modelCallCount = 0;

  const harness = createHarness({
    generateTextFn: async () => {
      modelCallCount += 1;
      if (modelCallCount === 1) {
        await firstBlocked;
        return fakeTextResult("## messages\n첫 응답");
      }

      return fakeTextResult("## messages\n두 번째 응답");
    },
  });

  const firstInput = createUserMessage(harness, {
    id: `abort-first-${randomUUID()}`,
    content: "먼저 이 메시지",
  });
  await harness.messageService.saveMessage(firstInput);

  const firstRun = harness.chatFlow.execute({
    channel: harness.channel,
    botId: harness.botId,
  });

  await new Promise((resolve) => {
    const interval = setInterval(() => {
      if (modelCallCount === 1) {
        clearInterval(interval);
        resolve();
      }
    }, 10);
  });

  const channel = await prisma.channel.findUnique({
    where: {
      platform_platformId: {
        platform: "cli",
        platformId: harness.channel.platformChannelId,
      },
    },
  });

  harness.generationAbortRegistry.abortChannel(channel.id);
  await harness.generationRepository.cancelProcessing(channel.id);
  releaseFirst();
  await firstRun;

  const secondInput = createUserMessage(harness, {
    id: `abort-second-${randomUUID()}`,
    content: "두 번째 메시지",
  });
  await harness.messageService.saveMessage(secondInput);
  await harness.chatFlow.execute({
    channel: harness.channel,
    botId: harness.botId,
  });

  const generations = await prisma.generation.findMany({
    where: { channelId: channel.id },
    orderBy: { id: "asc" },
  });

  assert.strictEqual(generations.length, 2);
  assert.strictEqual(generations[0].status, "CANCELLED");
  assert.strictEqual(generations[1].status, "COMPLETED");
  assert.deepStrictEqual(harness.sentMessages, ["두 번째 응답"]);
});

function createHarness({ generateTextFn }) {
  const generationAbortRegistry = new ChatGenerationAbortRegistry();
  const id = randomUUID();
  const botId = `bot-${id}`;
  const mockClient = createMockClient({ botId });
  const sentMessages = [];
  const channel = createMockChannel({
    channelId: `channel-${id}`,
    mockClient,
    onSend: (content) => sentMessages.push(content),
  });
  const config = {
    app: { language: "ko-KR" },
    character: "fixture",
    ai: {
      chat: {
        provider: "openai",
        model: "fake-model",
        prompt: "minimal",
      },
    },
    conversation: {
      maxContextMessages: 50,
      typingDelayMin: 0,
      typingDelayMax: 0,
      typingDelayPerChar: 0,
    },
    tools: { maxSteps: 5 },
  };
  const configManager = {
    get: (key) => key.split(".").reduce((value, part) => value?.[part], config),
    getAll: () => config,
  };
  const userRepository = new UserRepository();
  const platformAccountRepository = new PlatformAccountRepository();
  const channelRepository = new ChannelRepository();
  const serverRepository = new ServerRepository();
  const messageRepository = new MessageRepository(configManager);
  const generationRepository = new GenerationRepository(configManager);
  const eventBus = new EventBus();
  const messageService = new MessageService(
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    messageRepository,
  );
  const historyService = new HistoryService(
    messageRepository,
    new HistoryMessageFormatter(),
  );
  const characterContextBuilder = new CharacterContextBuilder({
    identityPath: "test/fixtures/character/identity.md",
    variablesPath: "test/fixtures/character/variables.json",
  });
  const promptComposer = new PromptComposer(
    configManager,
    characterContextBuilder,
  );
  const sequenceBuilder = new SequenceBuilder(promptComposer, {
    promptsRoot: "test/fixtures/prompts",
  });
  const chatContextPreparer = new ChatContextPreparer(
    historyService,
    configManager,
    sequenceBuilder,
  );
  const chatGenerator = new ChatGenerator({
    configManager,
    generateTextFn,
    createLanguageModelFn: () => ({ modelId: "fake-model" }),
  });
  const messageSender = new MessageSender(
    messageService,
    generationRepository,
    configManager,
  );
  const generationLifecycle = new ChatGenerationLifecycle(
    generationRepository,
    channelRepository,
    configManager,
  );
  const failureHandler = new ChatGenerationFailureHandler(
    generationLifecycle,
    messageSender,
    eventBus,
  );
  const chatFlow = new ChatFlow({
    chatContextPreparer,
    chatGenerator,
    messageSender,
    generationLifecycle,
    failureHandler,
    eventBus,
    generationAbortRegistry,
  });

  return {
    botId,
    channel,
    mockClient,
    sentMessages,
    eventBus,
    generationRepository,
    generationAbortRegistry,
    messageService,
    chatFlow,
  };
}

function createUserMessage(harness, { id, content }) {
  return adaptMessageData({
    id,
    content,
    channelId: harness.channel.platformChannelId,
    guildId: null,
    author: {
      id: `user-${harness.channel.platformChannelId}`,
      username: "integration-user",
      globalName: "Integration User",
      bot: false,
    },
    channel: harness.channel,
    client: harness.mockClient,
  });
}

function fakeTextResult(text) {
  return {
    text,
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    warnings: [],
    request: {},
    response: {},
    providerMetadata: {},
    steps: [],
    toolResults: [],
  };
}
