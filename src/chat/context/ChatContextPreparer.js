import { getRequiredChatPromptName } from "../promptConfig.js";

/**
 * Builds the model-ready chat context for a channel generation.
 */
export class ChatContextPreparer {
  /**
   * @param {import('../../messages/HistoryService.js').HistoryService} historyService
   * @param {import('../../config/ConfigManager.js').default} configManager
   * @param {import('./SequenceBuilder.js').SequenceBuilder} sequenceBuilder
   * @param {import('../memory/MemoryService.js').MemoryService|null} [memoryService]
   */
  constructor(
    historyService,
    configManager,
    sequenceBuilder,
    memoryService = null,
  ) {
    this.historyService = historyService;
    this.configManager = configManager;
    this.sequenceBuilder = sequenceBuilder;
    this.memoryService = memoryService;
  }

  /**
   * @param {string} channelId
   * @param {string} botId
   * @param {Object|null} [channelRecord]
   * @param {string|null} [cronMessage]
   * @returns {Promise<{context: Array, systemInstruction: string, messageIds: Array, inputMessages: Array<string>}>}
   */
  async prepare(channelId, botId, channelRecord = null, cronMessage = null) {
    const {
      historyMessages = [],
      pendingMessages = [],
      messageIds = [],
      inputMessages = [],
      lastUserPlatformAccountId = null,
    } = await this.historyService.fetchHistoryData(channelId, botId);

    const promptName = getRequiredChatPromptName(this.configManager);
    const sequenceDef = await this.sequenceBuilder.loadSequence(promptName);
    const memories = this.memoryService
      ? await this.memoryService.loadForPlatformAccount(
          lastUserPlatformAccountId,
        )
      : [];
    const userMemories = this.memoryService?.formatForContext(memories);
    const { systemInstruction, context } = await this.sequenceBuilder.build(
      sequenceDef,
      {
        historyMessages,
        pendingMessages,
        botId,
        cronMessage,
        channelRecord,
        promptName,
        data: { userMemories },
      },
    );

    const contextWithMemories = prependMemoryContext(context, userMemories);

    return {
      context: contextWithMemories,
      systemInstruction,
      messageIds,
      inputMessages,
    };
  }
}

function prependMemoryContext(context, userMemories) {
  if (!userMemories) return context;

  return [{ role: "user", content: userMemories }, ...context];
}
