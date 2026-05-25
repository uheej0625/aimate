import { MessageRepository } from "../repositories/MessageRepository.js";
import { UserRepository } from "../repositories/UserRepository.js";
import { PlatformAccountRepository } from "../repositories/PlatformAccountRepository.js";
import { ChannelRepository } from "../repositories/ChannelRepository.js";
import { ServerRepository } from "../repositories/ServerRepository.js";
import { GenerationRepository } from "../repositories/GenerationRepository.js";
import { EmotionStateRepository } from "../repositories/EmotionStateRepository.js";
import { CronJobRepository } from "../repositories/CronJobRepository.js";
import { AIService } from "../services/AIService.js";
import { HistoryService } from "../services/HistoryService.js";
import { MessageService } from "../services/MessageService.js";
import { BotAccountService } from "../services/BotAccountService.js";
import { CronService } from "../services/CronService.js";
import { CharacterContextBuilder } from "../services/CharacterContextBuilder.js";
import { PromptComposer } from "../services/PromptComposer.js";
import { SequenceBuilder } from "../services/SequenceBuilder.js";
import { AIModelFactory } from "../services/AIModelFactory.js";
import { AIResponseParser } from "../services/AIResponseParser.js";
import { ChatContextPreparer } from "../services/ChatContextPreparer.js";
import { ChatGenerationService } from "../services/ChatGenerationService.js";
import { GeneratedImageTagPolicy } from "../services/GeneratedImageTagPolicy.js";
import { GeneratedImageAttachmentResolver } from "../services/GeneratedImageAttachmentResolver.js";
import { HistoryMessageFormatter } from "../services/HistoryMessageFormatter.js";
import { ToolCallingChatRunner } from "../services/ToolCallingChatRunner.js";
import { validateActiveProviders } from "../config/index.js";
import { MessageHandler } from "./MessageHandler.js";
import { ConversationBuffer } from "./ConversationBuffer.js";
import { MessageSender } from "./MessageSender.js";
import { ChatFlow } from "./ChatFlow.js";
import { AppEvents, EventBus } from "./EventBus.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { PostGenerationStateUpdater } from "../services/PostGenerationStateUpdater.js";
import { createLogger } from "./logger.js";

const logger = createLogger("Container");

/**
 * Dependency Injection Container
 * Creates and wires up all application services with their dependencies.
 *
 * This ensures:
 * - No circular dependencies
 * - Single source of truth for instance creation
 * - Easy testing with mock dependencies
 */
export async function createContainer({ configManager, client = null }) {
  if (!configManager) {
    throw new Error("createContainer requires a configManager.");
  }

  await validateActiveProviders(configManager);

  // Repositories (data layer)
  const historyMessageFormatter = new HistoryMessageFormatter();
  const messageRepository = new MessageRepository(configManager);
  const userRepository = new UserRepository();
  const platformAccountRepository = new PlatformAccountRepository();
  const channelRepository = new ChannelRepository();
  const serverRepository = new ServerRepository();
  const generationRepository = new GenerationRepository();
  const emotionStateRepository = new EmotionStateRepository();
  const cronJobRepository = new CronJobRepository();
  const eventBus = new EventBus();

  // Tools (function calling)
  const toolRegistry = new ToolRegistry(configManager);
  await toolRegistry.loadFromDirectory();

  // platformClients: platform ID → 클라이언트 인스턴스 (discord client 등)
  const platformClients = new Map();
  if (client) platformClients.set("discord", client);

  // CronService는 나중에 초기화 (conversationBuffer 필요)
  let cronService = null;

  const toolExecutor = new ToolExecutor(
    toolRegistry,
    configManager,
    platformClients,
    null, // cronService는 나중에 설정
    generationRepository,
  );

  // Services (business logic layer)
  const historyService = new HistoryService(
    messageRepository,
    historyMessageFormatter,
  );
  const characterContextBuilder = new CharacterContextBuilder();
  const promptComposer = new PromptComposer(
    emotionStateRepository,
    configManager,
    characterContextBuilder,
  );
  const sequenceBuilder = new SequenceBuilder(promptComposer);
  const modelFactory = new AIModelFactory(configManager);
  const chatModel = modelFactory.create("chat");
  const imageModel = modelFactory.create("image");
  const responseParser = new AIResponseParser();
  const generatedImageTagPolicy = new GeneratedImageTagPolicy();
  const chatContextPreparer = new ChatContextPreparer(
    historyService,
    configManager,
    sequenceBuilder,
    userRepository,
  );
  const chatGenerationRunner = new ToolCallingChatRunner(configManager, {
    responseParser,
    generatedImageTagPolicy,
  });
  const aiService = new AIService(
    historyService,
    configManager,
    toolRegistry,
    toolExecutor,
    promptComposer,
    userRepository,
    sequenceBuilder,
    {
      modelFactory,
      responseParser,
      generatedImageTagPolicy,
      chatContextPreparer,
      chatGenerationRunner,
      chatModel,
      imageModel,
    },
  );
  const chatGenerationService = new ChatGenerationService({
    chatContextPreparer,
    chatGenerationRunner,
    chatModel,
    toolRegistry,
    toolExecutor,
    aiService,
  });
  const messageService = new MessageService(
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    messageRepository,
    generationRepository,
  );

  // Core Components (New Architecture)
  const messageSender = new MessageSender(
    messageService,
    generationRepository,
    configManager,
    {
      generatedImageAttachmentResolver: new GeneratedImageAttachmentResolver(
        generationRepository,
      ),
    },
  );

  const postGenerationStateUpdater = new PostGenerationStateUpdater(
    emotionStateRepository,
    userRepository,
  );

  eventBus.on(
    AppEvents.GenerationServiceUnavailable,
    async ({ channelRecord, platform }) => {
      // Discord status update
      if (client) {
        const fallbackStatus =
          configManager.get("discord.fallbackStatus") || "dnd";
        await client.user.setStatus(fallbackStatus);
        logger.info({ status: fallbackStatus }, "Bot status changed");
      }

      // Schedule retry cron job if cronService is available
      if (cronService && channelRecord) {
        try {
          await cronService.registerRetryJob(
            channelRecord.id,
            platform,
            0, // retryCount starts at 0
          );
          logger.info(
            { channelId: channelRecord.id },
            "Retry cron job scheduled",
          );
        } catch (cronError) {
          logger.error({ err: cronError }, "Failed to schedule retry");
        }
      }
    },
  );

  const chatFlow = new ChatFlow(
    generationRepository,
    channelRepository,
    messageRepository,
    chatGenerationService,
    messageSender,
    configManager,
    postGenerationStateUpdater,
    { eventBus },
  );

  const conversationBuffer = new ConversationBuffer(chatFlow, configManager);

  // CronService 초기화 (conversationBuffer 준비 완료 후)
  cronService = new CronService(
    cronJobRepository,
    conversationBuffer,
    platformClients,
  );

  // ToolExecutor에 cronService 설정
  toolExecutor.cronService = cronService;

  const messageHandler = new MessageHandler(
    messageService,
    generationRepository,
    conversationBuffer,
    channelRepository,
  );

  const botAccountService = new BotAccountService(
    userRepository,
    platformAccountRepository,
  );

  return {
    // Repositories
    messageRepository,
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    generationRepository,
    emotionStateRepository,
    cronJobRepository,

    // Services & Components
    aiService,
    historyService,
    messageService,
    chatGenerationService,
    botAccountService,
    cronService,
    configManager,
    sequenceBuilder,
    modelFactory,
    responseParser,
    generatedImageTagPolicy,
    chatContextPreparer,
    chatGenerationRunner,
    postGenerationStateUpdater,

    // Core
    eventBus,
    messageHandler,
    conversationBuffer,
    chatFlow,
    messageSender,

    // Tools
    toolRegistry,
    toolExecutor,
  };
}
