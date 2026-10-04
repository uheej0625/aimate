import { MessageRepository } from "../repositories/MessageRepository.js";
import { EventRepository } from "../repositories/EventRepository.js";
import { UserRepository } from "../repositories/UserRepository.js";
import { PlatformAccountRepository } from "../repositories/PlatformAccountRepository.js";
import { ChannelRepository } from "../repositories/ChannelRepository.js";
import { ServerRepository } from "../repositories/ServerRepository.js";
import { GenerationRepository } from "../repositories/GenerationRepository.js";
import { ChatGenerator } from "../ai/ChatGenerator.js";
import { ImageGenerator } from "../ai/ImageGenerator.js";
import { HistoryService } from "../messages/HistoryService.js";
import { MessageService } from "../messages/MessageService.js";
import { BotAccountService } from "../accounts/BotAccountService.js";
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
import { ConversationSession } from "../chat/ConversationSession.js";
import { MessageSender } from "../messages/MessageSender.js";
import { ChatFlow } from "../chat/ChatFlow.js";
import { ChatGenerationLifecycle } from "../chat/ChatGenerationLifecycle.js";
import { ChatGenerationFailureHandler } from "../chat/ChatGenerationFailureHandler.js";
import { ChatGenerationAbortRegistry } from "../chat/ChatGenerationAbortRegistry.js";
import { EventBus } from "./EventBus.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutionContextFactory } from "../tools/ToolExecutionContextFactory.js";
import { ActivateChannel } from "../application/ActivateChannel.js";
import { StoredMessageService } from "../application/StoredMessageService.js";
import { GetGenerationInfo } from "../application/GetGenerationInfo.js";
import { RerollConversation } from "../application/RerollConversation.js";
import { ChannelCatalog } from "../application/ChannelCatalog.js";
import { ReadChatTurn } from "../application/ReadChatTurn.js";

/**
 * Application composition root.
 * Creates core services while platform bootstraps supply their adapters.
 */
export async function createContainer({
  configManager,
  platformClients = new Map(),
  imageGenerator: suppliedImageGenerator = null,
  chatGenerator: suppliedChatGenerator = null,
}) {
  if (!configManager) {
    throw new Error("createContainer requires a configManager.");
  }

  await validateAiConfig(
    configManager,
    suppliedImageGenerator ? ["chat"] : undefined,
  );

  const characterContextBuilder = new CharacterContextBuilder({
    configManager,
  });
  await characterContextBuilder.loadConfig();

  // Repositories (data layer)
  const historyMessageFormatter = new HistoryMessageFormatter();
  const messageRepository = new MessageRepository(configManager);
  const eventRepository = new EventRepository(configManager);
  const userRepository = new UserRepository();
  const platformAccountRepository = new PlatformAccountRepository();
  const channelRepository = new ChannelRepository();
  const serverRepository = new ServerRepository();
  const generationRepository = new GenerationRepository(configManager);
  const eventBus = new EventBus();
  const generationAbortRegistry = new ChatGenerationAbortRegistry();
  const conversationSession = new ConversationSession();

  // Tools (function calling)
  const toolRegistry = new ToolRegistry(configManager);
  await toolRegistry.loadFromDirectory();

  const imageGenerator =
    suppliedImageGenerator ?? new ImageGenerator(configManager);
  const toolContextFactory = new ToolExecutionContextFactory({
    configManager,
    imageGenerator,
    generationRepository,
    platformClients,
  });

  // Services (business logic layer)
  const historyService = new HistoryService(
    eventRepository,
    messageRepository,
    historyMessageFormatter,
  );
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
  const chatGenerator =
    suppliedChatGenerator ??
    new ChatGenerator({
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
    eventRepository,
    configManager,
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

  const activateChannel = new ActivateChannel(
    channelRepository,
    serverRepository,
  );
  const getGenerationInfo = new GetGenerationInfo(messageRepository);
  const rerollConversation = new RerollConversation(
    messageRepository,
    messageService,
    chatFlow,
    generationLifecycle,
    conversationSession,
  );
  const channelCatalog = new ChannelCatalog(
    channelRepository,
    messageRepository,
  );
  const readChatTurn = new ReadChatTurn(messageRepository);

  const conversationBuffer = new ConversationBuffer(
    chatFlow,
    configManager,
    conversationSession,
  );

  const messageHandler = new MessageHandler(
    messageService,
    generationLifecycle,
    conversationBuffer,
    channelRepository,
    generationAbortRegistry,
    conversationSession,
  );

  const storedMessageService = new StoredMessageService(messageHandler);

  const botAccountService = new BotAccountService(
    userRepository,
    platformAccountRepository,
  );

  return {
    activateChannel,
    storedMessageService,
    getGenerationInfo,
    rerollConversation,
    channelCatalog,
    readChatTurn,
    botAccountService,
    eventBus,
    generationRepository,
    generationAbortRegistry,
    messageHandler,
    conversationBuffer,
    chatFlow,
  };
}
