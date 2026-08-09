import { MessageRepository } from "../repositories/MessageRepository.js";
import { UserRepository } from "../repositories/UserRepository.js";
import { PlatformAccountRepository } from "../repositories/PlatformAccountRepository.js";
import { ChannelRepository } from "../repositories/ChannelRepository.js";
import { ServerRepository } from "../repositories/ServerRepository.js";
import { GenerationRepository } from "../repositories/GenerationRepository.js";
import { CronJobRepository } from "../repositories/CronJobRepository.js";
import { ChatGenerator } from "../ai/ChatGenerator.js";
import { ImageGenerator } from "../ai/ImageGenerator.js";
import { HistoryService } from "../messages/HistoryService.js";
import { MessageService } from "../messages/MessageService.js";
import { BotAccountService } from "../accounts/BotAccountService.js";
import { CronJobScheduler } from "../scheduling/CronJobScheduler.js";
import { CronJobWorker } from "../scheduling/CronJobWorker.js";
import { registerRetryPolicy } from "../scheduling/registerRetryPolicy.js";
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
import { EventBus } from "./EventBus.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutionContextFactory } from "../tools/ToolExecutionContextFactory.js";

/**
 * Application composition root.
 * Creates core services while platform bootstraps supply their adapters.
 */
export async function createContainer({
  configManager,
  platformClients = new Map(),
  platformDispatchers = new Map(),
}) {
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
  registerRetryPolicy({ eventBus, cronJobScheduler });

  // Tools (function calling)
  const toolRegistry = new ToolRegistry(configManager);
  await toolRegistry.loadFromDirectory();

  const imageGenerator = new ImageGenerator(configManager);
  const toolContextFactory = new ToolExecutionContextFactory({
    configManager,
    cronJobScheduler,
    imageGenerator,
    generationRepository,
    platformClients,
  });

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
  const chatGenerator = new ChatGenerator({
    configManager,
    toolRegistry,
    responseParser,
    generatedImageTagPolicy,
    toolContextFactory,
  });
  const messageService = new MessageService(
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    messageRepository,
    generationRepository,
  );

  // Message delivery
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

  const chatFlow = new ChatFlow(
    generationRepository,
    channelRepository,
    messageRepository,
    chatContextPreparer,
    chatGenerator,
    messageSender,
    configManager,
    { eventBus },
  );

  const conversationBuffer = new ConversationBuffer(chatFlow, configManager);

  const cronJobWorker = new CronJobWorker(
    cronJobRepository,
    conversationBuffer,
    platformDispatchers,
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
    messageRepository,
    channelRepository,
    serverRepository,
    botAccountService,
    cronJobWorker,
    eventBus,
    messageHandler,
    conversationBuffer,
    chatFlow,
  };
}
