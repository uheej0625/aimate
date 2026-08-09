import { MessageRepository } from "../repositories/MessageRepository.js";
import { UserRepository } from "../repositories/UserRepository.js";
import { PlatformAccountRepository } from "../repositories/PlatformAccountRepository.js";
import { ChannelRepository } from "../repositories/ChannelRepository.js";
import { ServerRepository } from "../repositories/ServerRepository.js";
import { GenerationRepository } from "../repositories/GenerationRepository.js";
import { CronJobRepository } from "../repositories/CronJobRepository.js";
import { AiRuntime } from "../ai/AiRuntime.js";
import { HistoryService } from "../messages/HistoryService.js";
import { MessageService } from "../messages/MessageService.js";
import { BotAccountService } from "../accounts/BotAccountService.js";
import { CronJobScheduler } from "../scheduling/CronJobScheduler.js";
import { CronJobWorker } from "../scheduling/CronJobWorker.js";
import { CharacterContextBuilder } from "../character/CharacterContextBuilder.js";
import { PromptComposer } from "../chat/context/PromptComposer.js";
import { SequenceBuilder } from "../chat/context/SequenceBuilder.js";
import { AIResponseParser } from "../chat/response/AIResponseParser.js";
import { ChatContextPreparer } from "../chat/context/ChatContextPreparer.js";
import { GeneratedImageTagPolicy } from "../chat/response/GeneratedImageTagPolicy.js";
import { GeneratedImageAttachmentResolver } from "../messages/GeneratedImageAttachmentResolver.js";
import { HistoryMessageFormatter } from "../messages/HistoryMessageFormatter.js";
import { validateAiConfig } from "../config/index.js";
import { MessageHandler } from "../messages/MessageHandler.js";
import { ConversationBuffer } from "../chat/ConversationBuffer.js";
import { MessageSender } from "../messages/MessageSender.js";
import { ChatFlow } from "../chat/ChatFlow.js";
import { AppEvents, EventBus } from "./EventBus.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
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

  await validateAiConfig(configManager);

  // Repositories (data layer)
  const historyMessageFormatter = new HistoryMessageFormatter();
  const messageRepository = new MessageRepository(configManager);
  const userRepository = new UserRepository();
  const platformAccountRepository = new PlatformAccountRepository();
  const channelRepository = new ChannelRepository();
  const serverRepository = new ServerRepository();
  const generationRepository = new GenerationRepository(configManager);
  const cronJobRepository = new CronJobRepository();
  const cronJobScheduler = new CronJobScheduler(cronJobRepository);
  const eventBus = new EventBus();

  // Tools (function calling)
  const toolRegistry = new ToolRegistry(configManager);
  await toolRegistry.loadFromDirectory();

  // platformClients: platform ID → 클라이언트 인스턴스 (discord client 등)
  const platformClients = new Map();
  if (client) platformClients.set("discord", client);

  // Services (business logic layer)
  const historyService = new HistoryService(
    messageRepository,
    historyMessageFormatter,
  );
  const characterContextBuilder = new CharacterContextBuilder({
    configManager,
  });
  const promptComposer = new PromptComposer(
    configManager,
    characterContextBuilder,
  );
  const sequenceBuilder = new SequenceBuilder(promptComposer);
  const responseParser = new AIResponseParser();
  const generatedImageTagPolicy = new GeneratedImageTagPolicy();
  const chatContextPreparer = new ChatContextPreparer(
    historyService,
    configManager,
    sequenceBuilder,
  );
  const aiRuntime = new AiRuntime({
    historyService,
    configManager,
    toolRegistry,
    promptComposer,
    sequenceBuilder,
    responseParser,
    generatedImageTagPolicy,
    chatContextPreparer,
    platformClients,
    generationRepository,
    cronJobScheduler,
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

      // Schedule retry cron job if channel context is available
      if (channelRecord) {
        try {
          await cronJobScheduler.registerRetryJob(
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
    aiRuntime,
    messageSender,
    configManager,
    { eventBus },
  );

  const conversationBuffer = new ConversationBuffer(chatFlow, configManager);

  const cronJobWorker = new CronJobWorker(
    cronJobRepository,
    conversationBuffer,
    platformClients,
  );

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
    cronJobRepository,

    // Services & Components
    aiRuntime,
    historyService,
    messageService,
    botAccountService,
    cronJobScheduler,
    cronJobWorker,
    configManager,
    sequenceBuilder,
    responseParser,
    generatedImageTagPolicy,
    chatContextPreparer,

    // Core
    eventBus,
    messageHandler,
    conversationBuffer,
    chatFlow,
    messageSender,

    // Tools
    toolRegistry,
  };
}
