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
import { loadAiCredentials } from "../ai/credentials.js";
import { MessageHandler } from "../messages/MessageHandler.js";
import { ConversationBuffer } from "../chat/ConversationBuffer.js";
import { ConversationSession } from "../chat/ConversationSession.js";
import { ConversationDecider } from "../ai/ConversationDecider.js";
import { DecisionBuffer } from "../chat/decision/DecisionBuffer.js";
import { DecisionContext } from "../chat/decision/DecisionContext.js";
import { getDecisionSettings } from "../chat/decision/config.js";
import { MessageSender } from "../messages/MessageSender.js";
import { ChatFlow } from "../chat/ChatFlow.js";
import { ChatGenerationLifecycle } from "../chat/ChatGenerationLifecycle.js";
import { ChatGenerationFailureHandler } from "../chat/ChatGenerationFailureHandler.js";
import { ChatGenerationAbortRegistry } from "../chat/ChatGenerationAbortRegistry.js";
import { EventBus } from "./EventBus.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ToolExecutionContextFactory } from "../tools/ToolExecutionContextFactory.js";
import { MessageActionService } from "../tools/MessageActionService.js";
import { MessageActionRepository } from "../repositories/MessageActionRepository.js";
import { StoredMessageService } from "../application/StoredMessageService.js";
import { GetGenerationInfo } from "../application/GetGenerationInfo.js";
import { RerollConversation } from "../application/RerollConversation.js";
import { ChannelCatalog } from "../application/ChannelCatalog.js";
import { ParticipantService } from "../chat/context/ParticipantService.js";
import { getRequiredCharacterId } from "../character/config.js";
import { drain } from "./drain.js";
import { PolicyRepository } from "../repositories/PolicyRepository.js";

/**
 * Application composition root.
 * Creates core services while platform bootstraps supply their adapters.
 */
export async function createContainer({
  configManager,
  credentials = loadAiCredentials(),
  connections = new Map(),
}) {
  if (!configManager) {
    throw new Error("createContainer requires a configManager.");
  }

  await validateAiConfig(configManager, undefined, credentials);
  const characterId = getRequiredCharacterId(configManager);
  const pendingWork = new Set();
  const conversationPolicy = {
    isEnabled: (channel) =>
      connections.get(channel.platform)?.isEnabled(channel) ?? false,
  };
  const participantSources = new Map(
    [...connections]
      .filter(([, connection]) => connection.participantSource)
      .map(([platform, connection]) => [
        platform,
        connection.participantSource,
      ]),
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

  const messageService = new MessageService(
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    messageRepository,
    eventRepository,
    configManager,
  );
  const messageActionService = new MessageActionService({
    messageRepository,
    messageService,
    generationRepository,
    actionRepository: new MessageActionRepository(),
  });

  // Tools (function calling)
  const toolRegistry = new ToolRegistry(configManager);
  await toolRegistry.loadFromDirectory();

  const imageGenerator = new ImageGenerator(configManager, { credentials });
  const participantService = new ParticipantService(participantSources);
  const toolContextFactory = new ToolExecutionContextFactory({
    configManager,
    imageGenerator,
    generationRepository,
    messageActionService,
    participantService,
    connections,
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
  const sequenceBuilder = new SequenceBuilder(promptComposer, {
    participantService,
  });
  const responseParser = new AIResponseParser();
  const generatedImageTagPolicy = new GeneratedImageTagPolicy();
  const chatContextPreparer = new ChatContextPreparer(
    historyService,
    configManager,
    sequenceBuilder,
  );
  const chatGenerator = new ChatGenerator({
    configManager,
    credentials,
    toolRegistry,
    responseParser,
    generatedImageTagPolicy,
    toolContextFactory,
  });

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
    conversationPolicy,
  });

  const getGenerationInfo = new GetGenerationInfo(
    messageRepository,
    characterId,
  );
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
    new PolicyRepository(characterId),
  );

  const decisionSettings = getDecisionSettings(configManager);
  const decider =
    configManager.get("conversation.responseMode") === "decision"
      ? new ConversationDecider(configManager, credentials)
      : null;
  if (decider) await decider.loadPrompt();
  const conversationBuffer =
    configManager.get("conversation.responseMode") === "decision"
      ? new DecisionBuffer({
          chatFlow,
          conversationSession,
          generationAbortRegistry,
          generationLifecycle,
          conversationPolicy,
          settings: decisionSettings,
          decider,
          contextBuilder: new DecisionContext(
            eventRepository,
            decisionSettings,
            characterId,
            conversationPolicy,
          ),
        })
      : new ConversationBuffer(chatFlow, configManager, conversationSession);

  const messageHandler = new MessageHandler(
    messageService,
    generationLifecycle,
    conversationBuffer,
    channelRepository,
    generationAbortRegistry,
    conversationSession,
    conversationPolicy,
  );

  const storedMessageService = new StoredMessageService(messageHandler);

  const botAccountService = new BotAccountService(
    platformAccountRepository,
    configManager,
  );

  let closing;
  return {
    characterId,
    pendingWork,
    connections,
    async closePlatform(platform) {
      for (const key of [...conversationSession.states.keys()]) {
        const [source, platformChannelId] = JSON.parse(key);
        if (source !== platform) continue;
        conversationBuffer.clear({ platform, platformChannelId });
        conversationSession.stop(key);
        const channel = await channelRepository.findByPlatformId(
          platform,
          platformChannelId,
        );
        if (channel) generationAbortRegistry.abortChannel(channel.id);
      }
      await generationRepository.cancelPlatform(platform);
    },
    close() {
      closing ??= (async () => {
        messageHandler.closed = true;
        chatFlow.closed = true;
        conversationBuffer.clearAll();
        generationAbortRegistry.abortAll();
        await drain([
          ...pendingWork,
          ...chatFlow.tasks.keys(),
          ...(conversationBuffer.tasks ?? []),
          ...conversationSession.queues.values(),
        ]);
        await generationRepository.cancelInProgress();
        conversationSession.clearAll();
      })();
      return closing;
    },
    storedMessageService,
    getGenerationInfo,
    rerollConversation,
    channelCatalog,
    botAccountService,
    eventBus,
    generationRepository,
    generationAbortRegistry,
    messageHandler,
    conversationBuffer,
    chatFlow,
  };
}
