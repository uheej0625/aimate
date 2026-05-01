export class HistoryService {
  /**
   * @param {import('../repositories/MessageRepository.js').MessageRepository} messageRepository
   */
  constructor(messageRepository) {
    this.messageRepository = messageRepository;
  }

  /**
   * DB에서 히스토리를 로드하고 메타데이터를 추출한다.
   * @param {string} channelId - Internal channel ID
   * @param {string} botId - Bot's platform user ID (platformId)
   * @returns {Promise<{history: Array, messageIds: Array<number>, inputMessages: Array<string>, lastUserPlatformAccountId: string|null}>}
   */
  async fetchHistoryData(channelId, botId) {
    const history = await this.messageRepository.getHistory(channelId);
    const pendingMessages = this.extractPendingMessages(history, botId);
    const messageIds = pendingMessages.map((m) => m.id);
    const inputMessages = pendingMessages.map((m) => m.content);

    let lastUserPlatformAccountId = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].authorPlatformId !== botId) {
        lastUserPlatformAccountId = history[i].authorId;
        break;
      }
    }

    return { history, messageIds, inputMessages, lastUserPlatformAccountId };
  }

  /**
   * 아직 답변되지 않은 user 메시지 목록을 추출한다.
   * 히스토리 끝에서 연속된 user 메시지를 수집하고, bot 응답을 만나면 중단.
   *
   * Example:
   * [bot, user, user, user] → returns [{id, content}, ...]
   * [user, bot, user] → returns [{id, content}]
   *
   * @param {Array} history - Message history array
   * @param {string} botId - Bot's Discord user ID (platformId)
   * @returns {Array<{id: number, content: string}>} Messages in chronological order
   */
  extractPendingMessages(history, botId) {
    const messages = [];

    // Traverse history backwards to find unanswered user messages
    for (let i = history.length - 1; i >= 0; i--) {
      const message = history[i];

      // Stop when we hit the bot's last response
      if (message.authorPlatformId === botId) {
        break;
      }

      // Collect user message
      messages.unshift({ id: message.id, content: message.content });
    }

    return messages;
  }
}
