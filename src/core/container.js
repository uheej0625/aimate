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
import { configManager } from "../config/index.js";
import { MessageHandler } from "./MessageHandler.js";
import { ConversationBuffer } from "./ConversationBuffer.js";
import { MessageSender } from "./MessageSender.js";
import { ChatFlow } from "./ChatFlow.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import { allTools } from "../tools/index.js";
import { CharacterLoader } from "../loaders/CharacterLoader.js";

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
  const aiService = new AIService(
    contextService,
    configManager,
    toolRegistry,
    toolExecutor,
    emotionStateRepository,
    characterLoader,
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
      onServiceUnavailable: async (error, context) => {
        // Discord status update
        if (client) {
          const fallbackStatus =
            configManager.get("discord.fallbackStatus") || "dnd";
          await client.user.setStatus(fallbackStatus);
          console.log(`Bot status changed to: ${fallbackStatus}`);
        }

        // Schedule retry cron job if cronService is available
        if (cronService && context?.channelRecord) {
          try {
            await cronService.registerRetryJob(
              context.channelRecord.id,
              context.platform,
              0, // retryCount starts at 0
            );
            console.log(
              "[503 Handler] Retry cron job scheduled for channel:",
              context.channelRecord.id,
            );
          } catch (cronError) {
            console.error("[503 Handler] Failed to schedule retry:", cronError);
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
