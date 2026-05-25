import { HistoryMessageFormatter } from "./HistoryMessageFormatter.js";

export class HistoryService {
  /**
   * @param {import('../repositories/MessageRepository.js').MessageRepository} messageRepository
   * @param {HistoryMessageFormatter} [historyMessageFormatter]
   */
  constructor(
    messageRepository,
    historyMessageFormatter = new HistoryMessageFormatter(),
  ) {
    this.messageRepository = messageRepository;
    this.historyMessageFormatter = historyMessageFormatter;
  }

  /**
   * DB에서 히스토리를 로드하고 메타데이터를 추출한다.
   * @param {string} channelId - Internal channel ID
   * @param {string} botId - Bot's platform user ID (platformId)
   * @returns {Promise<{history: Array, messageIds: Array<number>, inputMessages: Array<string>, lastUserPlatformAccountId: string|null}>}
   */
  async fetchHistoryData(channelId, botId) {
    const history = await this.loadModelHistory(channelId);
    const { historyMessages, pendingMessages } = this.splitHistoryAndPending(
      history,
      botId,
    );
    const messageIds = pendingMessages.map((m) => m.id);
    const inputMessages = pendingMessages.map((m) => m.content);

    let lastUserPlatformAccountId = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].authorPlatformId !== botId) {
        lastUserPlatformAccountId = history[i].authorId;
        break;
      }
    }

    return {
      history,
      historyMessages,
      pendingMessages,
      messageIds,
      inputMessages,
      lastUserPlatformAccountId,
    };
  }

  async loadModelHistory(internalChannelId) {
    if (
      typeof this.messageRepository.getHistoryRecords !== "function" ||
      typeof this.messageRepository.findGenerationInputsByIds !== "function"
    ) {
      return await this.messageRepository.getHistory(internalChannelId);
    }

    const records =
      await this.messageRepository.getHistoryRecords(internalChannelId);
    const generationIds =
      this.historyMessageFormatter.extractGeneratedImageGenerationIds(records);
    const promptByGenerationId =
      await this.messageRepository.findGenerationInputsByIds(generationIds);

    return this.historyMessageFormatter.format(records, promptByGenerationId);
  }

  /**
   * 히스토리를 이미 답변된 메시지와 아직 답변되지 않은 메시지로 나눈다.
   * @param {Array} history
   * @param {string} botId
   * @returns {{ historyMessages: Array, pendingMessages: Array }}
   */
  splitHistoryAndPending(history, botId) {
    let lastBotIndex = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].authorPlatformId === botId) {
        lastBotIndex = i;
        break;
      }
    }

    if (lastBotIndex === -1) {
      return { historyMessages: [], pendingMessages: [...history] };
    }

    return {
      historyMessages: history.slice(0, lastBotIndex + 1),
      pendingMessages: history.slice(lastBotIndex + 1),
    };
  }

  /**
   * 아직 답변되지 않은 user 메시지 목록을 추출한다.
   * @param {Array} history
   * @param {string} botId
   * @returns {Array}
   */
  extractPendingMessages(history, botId) {
    return this.splitHistoryAndPending(history, botId).pendingMessages;
  }
}
