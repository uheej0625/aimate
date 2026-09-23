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
const { EventRepository } = await import(
  "../../src/repositories/EventRepository.js"
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
const { ConversationSession } = await import(
  "../../src/chat/ConversationSession.js"
);
const { MessageHandler } = await import("../../src/messages/MessageHandler.js");
const { RerollConversation } = await import(
  "../../src/application/RerollConversation.js"
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
  await harness.executeChat();

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
  await harness.executeChat();

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
  const events = await prisma.event.findMany({
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
  assert.strictEqual(events.length, 5);
  assert.ok(events.every(({ characterId }) => characterId === "fixture"));
  assert.ok(
    events
      .filter(
        ({ snapshotContent }) =>
          snapshotContent === "안녕" || snapshotContent === "아까 뭐라고 했지?",
      )
      .every(({ generationId }) => generationId === null),
  );
  assert.ok(
    events
      .filter(
        ({ snapshotContent }) =>
          !["안녕", "아까 뭐라고 했지?"].includes(snapshotContent),
      )
      .every(({ generationId }) => generationId !== null),
  );
});

for (const content of ["", " \n\t"]) {
  test(`empty or whitespace input ${JSON.stringify(content)} is stored and answered`, async () => {
    const modelRequests = [];
    const h = createHarness({
      generateTextFn: async (request) => {
        modelRequests.push(request);
        return fakeTextResult("## messages\nreply to empty input");
      },
    });
    const channelRecord = await h.activate();
    const message = createUserMessage(h, { id: randomUUID(), content });

    const result = await h.receive("CREATE", { message });

    assert.equal(result.changed, true);
    assert.equal(result.refreshed, true);
    assert.equal(h.bufferedRequests.length, 1);
    await h.flush();
    assert.deepEqual(h.sentMessages, ["reply to empty input"]);
    assert.ok(
      modelRequests[0].messages.some(
        (entry) => entry.role === "user" && entry.content === content,
      ),
    );
    const stored = await prisma.message.findFirst({
      where: { channelId: channelRecord.id, isBot: false },
      include: { events: true, generation: true },
    });
    assert.equal(stored.content, content);
    assert.equal(stored.events[0].kind, "READ");
    assert.equal(stored.generation.status, "COMPLETED");
  });
}

test("bot delivery is stored once and its echoed create events never schedule a reply", async () => {
  const h = createHarness({
    generateTextFn: async () => fakeTextResult("## messages\none bot reply"),
  });
  const channelRecord = await h.activate();
  const send = h.channel.send;
  let sentMessage;
  h.channel.send = async (options) => {
    sentMessage = await send(options);
    const result = await h.receive("CREATE", { message: sentMessage });
    assert.equal(result.changed, false);
    return sentMessage;
  };

  await h.receive("CREATE", {
    message: createUserMessage(h, { id: randomUUID(), content: "hello" }),
  });
  await h.flush();
  await h.receive("CREATE", { message: sentMessage });

  assert.equal(h.bufferedRequests.length, 1);
  assert.deepEqual(h.sentMessages, ["one bot reply"]);
  const replies = await prisma.message.findMany({
    where: { channelId: channelRecord.id, isBot: true },
    include: { events: true, generation: true },
  });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].platformId, sentMessage.platformMessageId);
  assert.equal(replies[0].content, "one bot reply");
  assert.equal(replies[0].generation.status, "COMPLETED");
  assert.deepEqual(replies[0].events.map((event) => event.kind), ["SENT"]);
});

test("message persistence records changes and retains deletion tombstones", async () => {
  const harness = createHarness({
    generateTextFn: async () =>
      fakeTextResult("# response\n\n## messages\nreply"),
  });
  const original = createUserMessage(
    harness,
    {
      id: "current-message-state",
      content: "before",
    },
    { observed: true },
  );

  const created = await harness.messageService.saveMessage(original);
  const duplicate = await harness.messageService.saveMessage(original);
  const updated = await harness.messageService.updateMessage(
    {
      ...original,
      content: "after",
    },
    { observed: true },
  );
  const unchanged = await harness.messageService.updateMessage(
    {
      ...original,
      content: "after",
    },
    { observed: true },
  );
  const reverted = await harness.messageService.updateMessage(
    {
      ...original,
      content: "before",
    },
    { observed: true },
  );
  const missing = await harness.messageService.updateMessage({
    ...original,
    platformMessageId: "missing-current-message",
    content: "ignored",
  });

  const stored = await harness.messageRepository.findByPlatformId(
    "cli",
    original.platformMessageId,
  );

  assert.strictEqual(created.changed, true);
  assert.strictEqual(duplicate.changed, false);
  assert.strictEqual(updated.changed, true);
  assert.strictEqual(unchanged.changed, false);
  assert.strictEqual(missing.changed, true);
  assert.strictEqual(reverted.changed, true);
  assert.strictEqual(stored.content, "before");

  const { deletedCount } = await harness.messageService.deleteMessages(
    "cli",
    [original.platformMessageId],
    created.channel.id,
    { observed: true },
  );
  const lateUpdate = await harness.messageService.updateMessage({
    ...original,
    content: "late update",
  });
  const lateSave = await harness.messageService.saveMessage({
    ...original,
    content: "late create",
  });
  const repeatedDelete = await harness.messageService.deleteMessages(
    "cli",
    [original.platformMessageId],
    created.channel.id,
    { observed: true },
  );
  const deleted = await harness.messageRepository.findByPlatformId(
    "cli",
    original.platformMessageId,
  );

  assert.strictEqual(deletedCount, 1);
  assert.strictEqual(lateUpdate.changed, false);
  assert.strictEqual(lateSave.changed, false);
  assert.strictEqual(repeatedDelete.deletedCount, 0);
  assert.deepStrictEqual(repeatedDelete.deletedMessages, []);
  assert.strictEqual(deleted, null);

  const events = await prisma.event.findMany({
    where: {
      platform: "cli",
      platformMessageId: original.platformMessageId,
    },
    include: { message: { include: { author: { include: { user: true } } } } },
    orderBy: { id: "asc" },
  });
  assert.deepStrictEqual(
    events.map(({ kind, snapshotContent }) => [kind, snapshotContent]),
    [
      ["READ", "before"],
      ["EDIT", "after"],
      ["EDIT", "before"],
      ["DELETE", "before"],
    ],
  );
  for (const event of events) {
    assert.strictEqual(event.messageId, created.message.id);
    assert.strictEqual(event.message.content, "before");
    assert.ok(event.message.deletedAt instanceof Date);
    assert.strictEqual(event.message.author.id, created.platformAccount.id);
    assert.strictEqual(
      event.message.author.user.id,
      created.platformAccount.userId,
    );
  }
  assert.ok(events.every(({ generationId }) => generationId === null));

  const unknownId = `unknown-delete-${randomUUID()}`;
  await harness.messageService.deleteMessages(
    "cli",
    [unknownId],
    created.channel.id,
    { observed: true },
  );
  await harness.messageService.deleteMessages(
    "cli",
    [unknownId],
    created.channel.id,
    { observed: true },
  );
  const unknownDeleteEvents = await prisma.event.findMany({
    where: { platform: "cli", platformMessageId: unknownId },
  });
  assert.strictEqual(unknownDeleteEvents.length, 0);
  const lateUnknown = await harness.messageService.saveMessage({
    ...original,
    platformMessageId: unknownId,
  });
  assert.strictEqual(lateUnknown.changed, false);
  assert.ok(lateUnknown.message.deletedAt);
});

test("soft deletion preserves references and hides messages from current queries", async (t) => {
  for (const mode of ["single", "batch", "channel"]) {
    await t.test(mode, async () => {
      const harness = createHarness({
        generateTextFn: async () => fakeTextResult("reply"),
      });
      const original = createUserMessage(harness, {
        id: `soft-delete-${randomUUID()}`,
        content: "retained content",
      });
      const attachments = [
        { name: "example.txt", text: "retained attachment" },
      ];
      const created = await harness.messageService.saveMessage(
        original,
        null,
        attachments,
      );
      const generation = await harness.generationRepository.create({
        channelId: created.channel.id,
        status: "PROCESSING",
      });
      await harness.messageRepository.addGenerationId(
        created.message.id,
        generation.id,
      );
      const memory = await prisma.memory.create({
        data: {
          userId: created.platformAccount.userId,
          messageId: created.message.id,
          content: "retained memory",
          category: "fact",
        },
      });
      const deleteMessage = () => {
        if (mode === "single") {
          return harness.messageService.deleteMessage(
            "cli",
            original.platformMessageId,
          );
        }
        if (mode === "batch") {
          return harness.messageService
            .deleteMessages(
              "cli",
              [original.platformMessageId],
              created.channel.id,
            )
            .then(({ deletedCount }) => deletedCount);
        }
        return harness.messageService.deleteMessagesByChannel(
          created.channel.id,
        );
      };

      assert.strictEqual(await deleteMessage(), mode === "single" ? true : 1);
      assert.strictEqual(await deleteMessage(), mode === "single" ? false : 0);
      const retained = await prisma.message.findUnique({
        where: { id: created.message.id },
        include: {
          events: { orderBy: { id: "asc" } },
          memories: true,
          author: true,
        },
      });
      assert.ok(retained.deletedAt instanceof Date);
      assert.strictEqual(retained.content, original.content);
      assert.strictEqual(retained.attachmentsJson, JSON.stringify(attachments));
      assert.strictEqual(retained.author.id, created.platformAccount.id);
      assert.strictEqual(retained.memories[0].id, memory.id);
      assert.deepStrictEqual(
        retained.events.map(({ kind }) => kind),
        ["READ"],
      );
      assert.ok(
        retained.events.every(
          (event) =>
            event.snapshotAttachmentsJson === JSON.stringify(attachments),
        ),
      );

      const repo = harness.messageRepository;
      assert.strictEqual(await repo.findById(created.message.id), null);
      assert.strictEqual(
        await repo.findByPlatformId("cli", original.platformMessageId),
        null,
      );
      assert.deepStrictEqual(
        await repo.findManyByPlatformIds("cli", [original.platformMessageId]),
        [],
      );
      assert.deepStrictEqual(await repo.getHistory(created.channel.id), []);
      assert.deepStrictEqual(
        await repo.getHistoryByPlatformChannelId(
          "cli",
          original.platformChannelId,
        ),
        [],
      );
      assert.deepStrictEqual(await repo.findByGenerationId(generation.id), []);

      await assert.rejects(
        harness.generationRepository.recordInputWithMessages(generation.id, {
          inputMessages: [original.content],
          messageIds: [created.message.id, 2147483647],
        }),
        /one or more messages are missing/,
      );
      assert.strictEqual(
        (await harness.generationRepository.findById(generation.id)).input,
        null,
      );
    });
  }
});

test("failed input stays pending after a fallback and joins new input on recovery", async () => {
  const modelRequests = [];
  const harness = createHarness({
    generateTextFn: async (request) => {
      modelRequests.push(request);
      if (modelRequests.length === 1)
        throw new Error("synthetic model failure");
      return fakeTextResult("## messages\nrecovered reply");
    },
  });
  const input = createUserMessage(harness, {
    id: `failed-user-message-${randomUUID()}`,
    content: "실패 테스트",
  });
  await harness.messageService.saveMessage(input);

  await harness.executeChat();

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
  assert.strictEqual(
    await prisma.conversationState.count({ where: { channelId: channel.id } }),
    0,
  );

  const nextInput = createUserMessage(harness, {
    id: randomUUID(),
    content: "다시 답해줘",
  });
  await harness.messageService.saveMessage(nextInput);
  await harness.executeChat();

  const recovered = await prisma.generation.findFirst({
    where: { channelId: channel.id },
    orderBy: { id: "desc" },
  });
  assert.strictEqual(recovered.status, "COMPLETED");
  assert.deepStrictEqual(
    JSON.parse(recovered.input).messages.map((message) => message.content),
    [input.content, nextInput.content],
  );
  for (const content of [input.content, nextInput.content]) {
    assert.ok(
      modelRequests[1].messages.some(
        (entry) => entry.role === "user" && entry.content === content,
      ),
    );
  }
  assert.strictEqual(harness.sentMessages.at(-1), "recovered reply");
  const history = await harness.historyService.fetchHistoryData(
    channel.id,
    harness.botId,
  );
  assert.deepStrictEqual(history.inputMessages, []);
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

  await harness.executeChat();

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

  const firstRun = harness.executeChat();

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
  await harness.executeChat();

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
  let now = 0;
  const conversationSession = new ConversationSession({ now: () => now });
  const bufferedRequests = [];
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
  const eventRepository = new EventRepository(configManager);
  const generationRepository = new GenerationRepository(configManager);
  const eventBus = new EventBus();
  const messageService = new MessageService(
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    messageRepository,
    eventRepository,
    configManager,
  );
  const historyService = new HistoryService(
    eventRepository,
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
    configManager,
  );
  const failureHandler = new ChatGenerationFailureHandler(
    generationLifecycle,
    messageSender,
    eventBus,
  );
  const chatFlow = new ChatFlow({
    chatContextPreparer,
    channelRepository,
    chatGenerator,
    messageSender,
    generationLifecycle,
    failureHandler,
    eventBus,
    generationAbortRegistry,
    conversationSession,
  });
  const messageHandler = new MessageHandler(
    messageService,
    generationLifecycle,
    { add: (request) => bufferedRequests.push(request) },
    channelRepository,
    generationAbortRegistry,
    conversationSession,
  );
  const rerollConversation = new RerollConversation(
    messageRepository,
    messageService,
    chatFlow,
    generationLifecycle,
    conversationSession,
  );
  const executeChat = async () => {
    const channelRecord = await channelRepository.findByPlatformId(
      channel.platform,
      channel.platformChannelId,
    );
    return await chatFlow.execute({
      channelPort: channel,
      internalChannelId: channelRecord.id,
      botId,
    });
  };

  return {
    botId,
    channel,
    mockClient,
    sentMessages,
    eventBus,
    generationRepository,
    generationAbortRegistry,
    messageService,
    messageRepository,
    chatFlow,
    executeChat,
    historyService,
    eventRepository,
    messageHandler,
    conversationSession,
    bufferedRequests,
    rerollConversation,
    setTime: (value) => {
      now = value;
    },
    activate: () =>
      channelRepository.upsert({
        platform: channel.platform,
        platformId: channel.platformChannelId,
      }),
    receive: (kind, data) =>
      messageHandler.handle({ kind, channel, botId, ...data }),
    flush: () => chatFlow.execute(bufferedRequests.at(-1)),
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

test("observed edit and deletion reach the model even after an earlier response", async () => {
  const requests = [];
  const h = createHarness({
    generateTextFn: async (request) => {
      requests.push(request);
      return fakeTextResult("## messages\n알겠어");
    },
  });
  const channelRecord = await h.activate();
  const message = createUserMessage(h, {
    id: randomUUID(),
    content: "하 시발",
  });
  await h.receive("CREATE", { message });
  await h.receive("UPDATE", {
    message: {
      ...message,
      content: "아 그게",
      editedAt: new Date("2026-09-20T01:00:00Z"),
    },
  });
  await h.flush();
  const firstContext = JSON.stringify(requests[0].messages);
  assert.match(firstContext, /하 시발/);
  assert.match(firstContext, /아 그게/);
  assert.match(firstContext, /수정 목격/);
  const firstState = await prisma.conversationState.findUnique({
    where: {
      characterId_channelId: {
        characterId: "fixture",
        channelId: channelRecord.id,
      },
    },
  });
  h.setTime(599_999);
  const deleted = await h.receive("DELETE", {
    platformMessageIds: [message.platformMessageId],
  });
  assert.equal(deleted.refreshed, true);
  await h.flush();
  assert.match(JSON.stringify(requests[1].messages), /삭제 목격/);
  const generations = await prisma.generation.findMany({
    where: { channelId: channelRecord.id },
    orderBy: { id: "asc" },
  });
  const input = JSON.parse(generations[1].input);
  assert.equal(input.messages.length, 1);
  assert.match(input.messages[0].content, /아 그게/);
  assert.ok(
    input.eventSnapshot.throughInclusive > firstState.handledThroughEventId,
  );
  assert.ok(
    generations.every((generation) => generation.status === "COMPLETED"),
  );
});

test("idle edits and deletions remain unobserved; a later edit marker is a historical read", async () => {
  const h = createHarness({
    generateTextFn: async () => fakeTextResult("## messages\nreply"),
  });
  const channelRecord = await h.activate();
  const original = createUserMessage(h, { id: randomUUID(), content: "A" });
  const other = createUserMessage(h, {
    id: randomUUID(),
    content: "delete me quietly",
  });
  await h.receive("CREATE", { message: original });
  await h.receive("CREATE", { message: other });
  await h.flush();
  h.setTime(600_000);
  const before = await prisma.event.count({
    where: { channelId: channelRecord.id },
  });
  await h.receive("UPDATE", {
    message: {
      ...original,
      content: "B",
      editedAt: new Date("2026-09-20T02:00:00Z"),
    },
  });
  await h.receive("DELETE", { platformMessageIds: [other.platformMessageId] });
  assert.equal(
    await prisma.event.count({ where: { channelId: channelRecord.id } }),
    before,
  );
  assert.equal(h.bufferedRequests.length, 2);
  const next = createUserMessage(h, {
    id: randomUUID(),
    content: "new conversation",
  });
  await h.receive("CREATE", { message: next });
  await h.flush();
  const generation = await prisma.generation.findFirst({
    where: { channelId: channelRecord.id },
    orderBy: { id: "desc" },
  });
  const input = JSON.parse(generation.input);
  const read = input.eventSnapshot.events.find(
    (event) => event.source === "HISTORY" && event.snapshotContent === "B",
  );
  assert.ok(read.editedAt);
  assert.equal(input.eventSnapshot.inputEventIds.includes(read.id), false);
  assert.equal(
    input.eventSnapshot.events.some(
      (event) => event.kind === "EDIT" || event.kind === "DELETE",
    ),
    false,
  );
  assert.equal(input.messages.length, 1);
});

test("deletion while watching never reveals an intermediate edit made while idle", async () => {
  const h = createHarness({
    generateTextFn: async () => fakeTextResult("## messages\nreply"),
  });
  const channelRecord = await h.activate();
  const original = createUserMessage(h, {
    id: randomUUID(),
    content: "seen A",
  });
  await h.receive("CREATE", { message: original });
  await h.flush();
  h.setTime(3_600_000);
  await h.receive("UPDATE", {
    message: { ...original, content: "unseen B", editedAt: new Date() },
  });
  await h.receive("CREATE", {
    message: createUserMessage(h, { id: randomUUID(), content: "look here" }),
  });
  await h.receive("DELETE", {
    platformMessageIds: [original.platformMessageId],
  });
  await h.flush();
  const events = await prisma.event.findMany({
    where: { channelId: channelRecord.id },
    orderBy: { id: "asc" },
  });
  assert.equal(
    events.find((event) => event.kind === "DELETE").snapshotContent,
    "seen A",
  );
  assert.equal(JSON.stringify(events).includes("unseen B"), false);
});

test("an edit interrupts in-flight generation and stale completion cannot advance the cursor", async () => {
  const started = deferred();
  const release = deferred();
  let calls = 0;
  const h = createHarness({
    generateTextFn: async () => {
      if (++calls === 1) {
        started.resolve();
        await release.promise;
        return fakeTextResult("## messages\nstale");
      }
      return fakeTextResult("## messages\ncurrent");
    },
  });
  const channelRecord = await h.activate();
  const original = createUserMessage(h, {
    id: randomUUID(),
    content: "before",
  });
  await h.receive("CREATE", { message: original });
  const first = h.flush();
  await started.promise;
  await h.receive("UPDATE", {
    message: { ...original, content: "after", editedAt: new Date() },
  });
  await h.flush();
  const completedState = await prisma.conversationState.findUnique({
    where: {
      characterId_channelId: {
        characterId: "fixture",
        channelId: channelRecord.id,
      },
    },
  });
  release.resolve();
  await first;
  assert.deepEqual(h.sentMessages, ["current"]);
  const generations = await prisma.generation.findMany({
    where: { channelId: channelRecord.id },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(
    generations.map((generation) => generation.status),
    ["CANCELLED", "COMPLETED"],
  );
  assert.match(generations[1].input, /before/);
  assert.match(generations[1].input, /after/);
  assert.equal(
    (
      await prisma.conversationState.findUnique({
        where: {
          characterId_channelId: {
            characterId: "fixture",
            channelId: channelRecord.id,
          },
        },
      })
    ).handledThroughEventId,
    completedState.handledThroughEventId,
  );
});

test("a change during delivery preserves the confirmed chunk but cancels remaining chunks", async () => {
  const started = deferred();
  const release = deferred();
  let calls = 0;
  const h = createHarness({
    generateTextFn: async () =>
      fakeTextResult(
        ++calls === 1
          ? "## messages\npartial[BREAK]never sent"
          : "## messages\nreplacement",
      ),
  });
  const channelRecord = await h.activate();
  const send = h.channel.send;
  let firstSend = true;
  h.channel.send = async (options) => {
    if (firstSend) {
      firstSend = false;
      started.resolve();
      await release.promise;
    }
    return await send(options);
  };
  const original = createUserMessage(h, {
    id: randomUUID(),
    content: "before send",
  });
  await h.receive("CREATE", { message: original });
  const first = h.flush();
  await started.promise;
  await h.receive("DELETE", {
    platformMessageIds: [original.platformMessageId],
  });
  release.resolve();
  await first;
  assert.deepEqual(h.sentMessages, ["partial"]);
  assert.equal(
    await prisma.conversationState.count({
      where: { channelId: channelRecord.id },
    }),
    0,
  );
  await h.flush();
  assert.deepEqual(h.sentMessages, ["partial", "replacement"]);
  const last = await prisma.generation.findFirst({
    where: { channelId: channelRecord.id },
    orderBy: { id: "desc" },
  });
  const input = JSON.parse(last.input);
  assert.equal(
    input.eventSnapshot.events.some(
      (event) => event.kind === "SENT" && event.snapshotContent === "partial",
    ),
    true,
  );
  assert.equal(input.messages.length, 2);
});

test("reroll reuses fixed input repeatedly and excludes discarded output without rewinding progress", async () => {
  let calls = 0;
  const h = createHarness({
    generateTextFn: async () => fakeTextResult(`## messages\nreply ${++calls}`),
  });
  const channelRecord = await h.activate();
  await h.receive("CREATE", {
    message: createUserMessage(h, {
      id: randomUUID(),
      content: "original input",
    }),
  });
  await h.flush();
  let previousCursor = 0;
  for (let i = 0; i < 2; i++) {
    const output = await prisma.message.findFirst({
      where: { channelId: channelRecord.id, isBot: true, deletedAt: null },
      orderBy: { id: "desc" },
    });
    const plan = await h.rerollConversation.prepare({
      platform: "cli",
      platformMessageId: output.platformId,
    });
    assert.equal(plan.status, "READY");
    assert.deepEqual(plan.platformMessageIds, [output.platformId]);
    await h.rerollConversation.execute({
      platform: "cli",
      generationId: plan.generationId,
      platformMessageIds: plan.platformMessageIds,
      conversationRequest: {
        channelPort: h.channel,
        internalChannelId: channelRecord.id,
        botId: h.botId,
      },
    });
    const last = await prisma.generation.findFirst({
      where: { channelId: channelRecord.id },
      orderBy: { id: "desc" },
    });
    const input = JSON.parse(last.input);
    assert.equal(last.status, "COMPLETED");
    assert.deepEqual(
      input.messages.map((message) => message.content),
      ["original input"],
    );
    assert.equal(
      input.eventSnapshot.events.some(
        (event) => event.snapshotContent === output.content,
      ),
      false,
    );
    const state = await prisma.conversationState.findUnique({
      where: {
        characterId_channelId: {
          characterId: "fixture",
          channelId: channelRecord.id,
        },
      },
    });
    assert.ok(state.handledThroughEventId >= previousCursor);
    previousCursor = state.handledThroughEventId;
  }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a failed observation write rolls back the message change", async () => {
  const h = createHarness({
    generateTextFn: async () => fakeTextResult("## messages\nreply"),
  });
  await h.activate();
  const original = createUserMessage(h, {
    id: randomUUID(),
    content: "atomic original",
  });
  await h.receive("CREATE", { message: original });
  const create = h.eventRepository.create.bind(h.eventRepository);
  h.eventRepository.create = async () => {
    throw new Error("event insert failed");
  };
  await assert.rejects(
    h.receive("UPDATE", {
      message: { ...original, content: "must roll back" },
    }),
    /event insert failed/,
  );
  h.eventRepository.create = create;
  assert.equal(
    (
      await h.messageRepository.findByPlatformId(
        "cli",
        original.platformMessageId,
      )
    ).content,
    "atomic original",
  );
  assert.equal(h.bufferedRequests.length, 1);
});

test("watch grace starts at delivery confirmation even when persistence finishes later", async () => {
  const h = createHarness({
    generateTextFn: async () => fakeTextResult("## messages\nreply"),
  });
  await h.activate();
  const save = h.messageService.saveMessage.bind(h.messageService);
  h.messageService.saveMessage = async (message, ...args) => {
    if (message.author.isBot) h.setTime(500_000);
    return await save(message, ...args);
  };
  await h.receive("CREATE", {
    message: createUserMessage(h, { id: randomUUID(), content: "hello" }),
  });
  await h.flush();
  const key = h.conversationSession.key(h.channel);
  h.setTime(599_999);
  assert.equal(h.conversationSession.isWatching(key), true);
  h.setTime(600_000);
  assert.equal(h.conversationSession.isWatching(key), false);
});

test("mixed bulk deletion records one batch and schedules only once", async () => {
  const h = createHarness({
    generateTextFn: async () => fakeTextResult("## messages\nreply"),
  });
  const channelRecord = await h.activate();
  const first = createUserMessage(h, { id: randomUUID(), content: "first" });
  const second = createUserMessage(h, { id: randomUUID(), content: "second" });
  await h.receive("CREATE", { message: first });
  await h.receive("CREATE", { message: second });
  await h.flush();
  const output = await prisma.message.findFirst({
    where: { channelId: channelRecord.id, isBot: true },
  });
  const ids = [
    first.platformMessageId,
    second.platformMessageId,
    output.platformId,
    randomUUID(),
  ];
  const before = h.bufferedRequests.length;
  await h.receive("DELETE", { platformMessageIds: ids });
  await h.receive("DELETE", { platformMessageIds: ids });
  assert.equal(h.bufferedRequests.length, before + 1);
  const deleted = await prisma.event.findMany({
    where: { channelId: channelRecord.id, kind: "DELETE" },
  });
  assert.equal(deleted.length, 3);
  assert.equal(new Set(deleted.map((event) => event.batchId)).size, 1);
  assert.ok(deleted[0].batchId);
});

test("older edit versions and duplicate create cannot roll back the current message", async () => {
  const h = createHarness({
    generateTextFn: async () => fakeTextResult("## messages\nreply"),
  });
  await h.activate();
  const original = createUserMessage(h, {
    id: randomUUID(),
    content: "original",
  });
  await h.receive("CREATE", { message: original });
  await h.receive("UPDATE", {
    message: {
      ...original,
      content: "newest",
      editedAt: new Date("2026-09-20T02:00:00Z"),
    },
  });
  const before = h.bufferedRequests.length;
  await h.receive("UPDATE", {
    message: {
      ...original,
      content: "older",
      editedAt: new Date("2026-09-20T01:00:00Z"),
    },
  });
  await h.receive("CREATE", { message: original });
  assert.equal(
    (
      await h.messageRepository.findByPlatformId(
        "cli",
        original.platformMessageId,
      )
    ).content,
    "newest",
  );
  assert.equal(h.bufferedRequests.length, before);
});

test("a confirmed output can fill a deletion tombstone without restoring the message", async () => {
  const h = createHarness({
    generateTextFn: async () => fakeTextResult("## messages\nreply"),
  });
  await h.activate();
  h.conversationSession.begin(h.conversationSession.key(h.channel));
  const output = await h.channel.send({ content: "actually delivered" });
  await h.receive("DELETE", { platformMessageIds: [output.platformMessageId] });
  const saved = await h.messageService.saveMessage(output);
  assert.ok(saved.message.deletedAt);
  assert.ok(saved.message.authorId);
  assert.equal(saved.message.isBot, true);
  const events = await prisma.event.findMany({
    where: { messageId: saved.message.id },
  });
  assert.deepEqual(
    events.map((event) => event.kind),
    ["SENT"],
  );
  assert.equal(events[0].snapshotContent, "actually delivered");
  assert.equal(
    await h.messageRepository.findByPlatformId("cli", output.platformMessageId),
    null,
  );
});

test("storage retry after confirmed delivery does not send the response twice", async () => {
  const h = createHarness({
    generateTextFn: async () => fakeTextResult("## messages\none reply"),
  });
  const channelRecord = await h.activate();
  const save = h.messageService.saveMessage.bind(h.messageService);
  let failed = false;
  h.messageService.saveMessage = async (message, ...args) => {
    if (message.author.isBot && !failed) {
      failed = true;
      throw new Error("temporary write failure");
    }
    return await save(message, ...args);
  };
  await h.receive("CREATE", {
    message: createUserMessage(h, { id: randomUUID(), content: "hello" }),
  });
  await h.flush();
  assert.deepEqual(h.sentMessages, ["one reply"]);
  const generation = await prisma.generation.findFirst({
    where: { channelId: channelRecord.id },
  });
  assert.equal(generation.status, "COMPLETED");
  assert.equal(
    await prisma.event.count({
      where: { channelId: channelRecord.id, kind: "SENT" },
    }),
    1,
  );
});

test("replaying an older snapshot does not resurrect outputs discarded since it was captured", async () => {
  let calls = 0;
  const h = createHarness({
    generateTextFn: async () =>
      fakeTextResult(`## messages\noutput ${++calls}`),
  });
  const channelRecord = await h.activate();
  await h.receive("CREATE", {
    message: createUserMessage(h, { id: randomUUID(), content: "first turn" }),
  });
  await h.flush();
  const first = await prisma.generation.findFirst({
    where: { channelId: channelRecord.id },
    orderBy: { id: "desc" },
  });
  await h.receive("CREATE", {
    message: createUserMessage(h, { id: randomUUID(), content: "second turn" }),
  });
  await h.flush();
  const second = await prisma.generation.findFirst({
    where: { channelId: channelRecord.id },
    orderBy: { id: "desc" },
  });
  assert.equal(
    JSON.parse(second.input).eventSnapshot.events.some(
      (event) => event.snapshotContent === "output 1",
    ),
    true,
  );
  await h.generationRepository.discard(first.id);
  await h.generationRepository.discard(second.id);
  const input = await h.historyService.fetchHistoryData(
    channelRecord.id,
    h.botId,
    second.id,
  );
  assert.deepEqual(input.inputMessages, ["second turn"]);
  assert.equal(
    input.eventSnapshot.events.some(
      (event) => event.snapshotContent === "output 1",
    ),
    false,
  );
});
