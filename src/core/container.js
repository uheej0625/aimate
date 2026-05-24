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
import { validateActiveProviders } from "../config/index.js";
import { MessageHandler } from "./MessageHandler.js";
import { ConversationBuffer } from "./ConversationBuffer.js";
import { MessageSender } from "./MessageSender.js";
import { ChatFlow } from "./ChatFlow.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
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
  const messageRepository = new MessageRepository(configManager);
  const userRepository = new UserRepository();
  const platformAccountRepository = new PlatformAccountRepository();
  const channelRepository = new ChannelRepository();
  const serverRepository = new ServerRepository();
  const generationRepository = new GenerationRepository();
  const emotionStateRepository = new EmotionStateRepository();
  const cronJobRepository = new CronJobRepository();

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
  const historyService = new HistoryService(messageRepository);
  const characterContextBuilder = new CharacterContextBuilder();
  const promptComposer = new PromptComposer(
    emotionStateRepository,
    configManager,
    characterContextBuilder,
  );
  const aiService = new AIService(
    historyService,
    configManager,
    toolRegistry,
    toolExecutor,
    promptComposer,
    userRepository,
  );
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
  );

  const chatFlow = new ChatFlow(
    generationRepository,
    channelRepository,
    messageRepository,
    aiService,
    messageSender,
    configManager,
    emotionStateRepository,
    {
      userRepository,
      onServiceUnavailable: async (error, context) => {
        // Discord status update
        if (client) {
          const fallbackStatus =
            configManager.get("discord.fallbackStatus") || "dnd";
          await client.user.setStatus(fallbackStatus);
          logger.info({ status: fallbackStatus }, "Bot status changed");
        }

        // Schedule retry cron job if cronService is available
        if (cronService && context?.channelRecord) {
          try {
            await cronService.registerRetryJob(
              context.channelRecord.id,
              context.platform,
              0, // retryCount starts at 0
            );
            logger.info(
              { channelId: context.channelRecord.id },
              "Retry cron job scheduled",
            );
          } catch (cronError) {
            logger.error({ err: cronError }, "Failed to schedule retry");
          }
        }
      },
    },
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
    botAccountService,
    cronService,
    configManager,

    // Core
    messageHandler,
    conversationBuffer,
    chatFlow,
    messageSender,

    // Tools
    toolRegistry,
    toolExecutor,
  };
}
