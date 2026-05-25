import { createLogger } from "../core/logger.js";

const logger = createLogger("ChatContextPreparer");

/**
 * Builds the model-ready chat context for a channel generation.
 */
export class ChatContextPreparer {
  /**
   * @param {import('./HistoryService.js').HistoryService} historyService
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {import('./SequenceBuilder.js').SequenceBuilder} sequenceBuilder
   * @param {import('../repositories/UserRepository.js').UserRepository|null} [userRepository]
   */
  constructor(
    historyService,
    configManager,
    sequenceBuilder,
    userRepository = null,
  ) {
    this.historyService = historyService;
    this.configManager = configManager;
    this.sequenceBuilder = sequenceBuilder;
    this.userRepository = userRepository;
  }

  /**
   * @param {string} channelId
   * @param {string} botId
   * @param {Object|null} [channelRecord]
   * @param {string|null} [cronMessage]
   * @returns {Promise<{context: Array, systemInstruction: string, messageIds: Array, inputMessages: Array<string>, currentUserId: string|null}>}
   */
  async prepare(channelId, botId, channelRecord = null, cronMessage = null) {
    const {
      historyMessages = [],
      pendingMessages = [],
      messageIds = [],
      inputMessages = [],
      lastUserPlatformAccountId,
    } = await this.historyService.fetchHistoryData(channelId, botId);

    const { currentUserId, userRecord } = await this._loadCurrentUser(
      lastUserPlatformAccountId,
    );

    const promptName = this.configManager.get("ai.chat.prompt") || "default";
    const sequenceDef = await this.sequenceBuilder.loadSequence(promptName);
    const { systemInstruction, context } = await this.sequenceBuilder.build(
      sequenceDef,
      {
        historyMessages,
        pendingMessages,
        botId,
        cronMessage,
        channelRecord,
        userRecord,
        promptName,
      },
    );

    return {
      context,
      systemInstruction,
      messageIds,
      inputMessages,
      currentUserId,
    };
  }

  async _loadCurrentUser(lastUserPlatformAccountId) {
    if (!this.userRepository || !lastUserPlatformAccountId) {
      return { currentUserId: null, userRecord: null };
    }

    try {
      const user = await this.userRepository.findByPlatformAccountId(
        lastUserPlatformAccountId,
      );
      return {
        currentUserId: user?.id ?? null,
        userRecord: user ?? null,
      };
    } catch (error) {
      logger.warn({ err: error }, "Failed to load relationship state");
      return { currentUserId: null, userRecord: null };
    }
  }
}
