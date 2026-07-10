/**
 * Builds the model-ready chat context for a channel generation.
 */
export class ChatContextPreparer {
  /**
   * @param {import('../../messages/HistoryService.js').HistoryService} historyService
   * @param {import('../../config/ConfigManager.js').default} configManager
   * @param {import('./SequenceBuilder.js').SequenceBuilder} sequenceBuilder
   */
  constructor(historyService, configManager, sequenceBuilder) {
    this.historyService = historyService;
    this.configManager = configManager;
    this.sequenceBuilder = sequenceBuilder;
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
    } = await this.historyService.fetchHistoryData(channelId, botId);

    const promptName = getRequiredChatPromptName(this.configManager);
    const sequenceDef = await this.sequenceBuilder.loadSequence(promptName);
    const { systemInstruction, context } = await this.sequenceBuilder.build(
      sequenceDef,
      {
        historyMessages,
        pendingMessages,
        botId,
        cronMessage,
        channelRecord,
        promptName,
      },
    );

    return {
      context,
      systemInstruction,
      messageIds,
      inputMessages,
    };
  }
}
import { getRequiredChatPromptName } from "../promptConfig.js";
