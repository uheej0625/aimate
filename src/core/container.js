import { MessageRepository } from "../repositories/MessageRepository.js";
import { UserRepository } from "../repositories/UserRepository.js";
import { PlatformAccountRepository } from "../repositories/PlatformAccountRepository.js";
import { ChannelRepository } from "../repositories/ChannelRepository.js";
import { ServerRepository } from "../repositories/ServerRepository.js";
import { GenerationRepository } from "../repositories/GenerationRepository.js";
import { EmotionStateRepository } from "../repositories/EmotionStateRepository.js";
import { CronJobRepository } from "../repositories/CronJobRepository.js";
import { AIService } from "../services/AIService.js";
import { ContextService } from "../services/ContextService.js";
import { MessageService } from "../services/MessageService.js";
import { BotAccountService } from "../services/BotAccountService.js";
import { CronService } from "../services/CronService.js";
import { PromptBuilder } from "../services/PromptBuilder.js";
import { configManager } from "../config/index.js";
import { MessageHandler } from "./MessageHandler.js";
import { ConversationBuffer } from "./ConversationBuffer.js";
import { MessageSender } from "./MessageSender.js";
import { ChatFlow } from "./ChatFlow.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { allTools } from "../tools/index.js";
import { CharacterLoader } from "../loaders/CharacterLoader.js";
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
export function createContainer(client = null) {
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
  toolRegistry.registerAll(allTools);

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
  );

  // Services (business logic layer)
  const contextService = new ContextService(messageRepository);
  const characterLoader = new CharacterLoader();
  const promptBuilder = new PromptBuilder(
    characterLoader,
    emotionStateRepository,
  );
  const aiService = new AIService(
    contextService,
    configManager,
    toolRegistry,
    toolExecutor,
    promptBuilder,
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
    contextService,
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
