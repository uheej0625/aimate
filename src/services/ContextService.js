export class ContextService {
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
   * @returns {Promise<{history: Array, messageIds: Array<string>, lastUserPlatformAccountId: string|null}>}
   */
  async fetchHistoryData(channelId, botId) {
    const history = await this.messageRepository.getHistory(channelId);
    const messageIds = this.extractPendingMessageIds(history, botId);

    let lastUserPlatformAccountId = null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].authorPlatformId !== botId) {
        lastUserPlatformAccountId = history[i].authorId;
        break;
      }
    }

    return { history, messageIds, lastUserPlatformAccountId };
  }

  /**
   * 히스토리 배열로부터 컨텍스트 배열을 조립한다 (DB 호출 없음).
   * @param {Array} history - Message history array
   * @param {string} botId - Bot's platform user ID (platformId)
   * @param {string|null} [cronMessage] - Cron job 메시지 (선택)
   * @param {string|null} [part1] - 히스토리 앞에 삽입할 user role 메시지 (선택)
   * @param {string|null} [part2] - 히스토리 뒤에 삽입할 user role 메시지 (선택)
   * @returns {Array}
   */
  assembleContext(
    history,
    botId,
    cronMessage = null,
    part1 = null,
    part2 = null,
  ) {
    const context = [];

    if (part1) {
      context.push({ role: "user", content: part1 });
    }

    for (const message of history) {
      context.push({
        role: message.authorPlatformId === botId ? "assistant" : "user",
        content: message.content,
      });
    }

    if (cronMessage) {
      context.push({
        role: "user",
        content:
          `[시스템: 예약된 작업 실행]\n` +
          `이것은 이전에 등록된 cron job이 예약된 시각에 자동 실행된 것입니다.\n` +
          `이 작업을 다시 예약하거나 새로운 cron job을 등록하지 마세요.\n\n` +
          cronMessage,
      });
    }

    if (part2) {
      context.push({ role: "user", content: part2 });
    }

    return context;
  }

  /**
   * Build the full context for AI generation, including history and system prompt.
   * @param {string} channelId - Internal channel ID
   * @param {string} botId - Bot's platform user ID (platformId)
   * @param {string} [cronMessage] - Cron job에서 전달되는 시스템 메시지 (선택)
   * @returns {Promise<{context: Array, messageIds: Array<string>, lastUserPlatformAccountId: string|null}>}
   */
  async buildContext(channelId, botId, cronMessage = null) {
    const { history, messageIds, lastUserPlatformAccountId } =
      await this.fetchHistoryData(channelId, botId);
    const context = this.assembleContext(history, botId, cronMessage);
    return { context, messageIds, lastUserPlatformAccountId };
  }

  /**
   * Extract user message IDs that haven't been responded to yet.
   * Collects all consecutive user messages from the end of history
   * until hitting the bot's last response.
   *
   * Example:
   * [bot, user, user, user] → returns [user, user, user]
   * [user, bot, user] → returns [user]
   *
   * @param {Array} history - Message history array
   * @param {string} botId - Bot's Discord user ID (platformId)
   * @returns {Array<string>} Array of message IDs in chronological order
   */
  extractPendingMessageIds(history, botId) {
    const messageIds = [];

    // Traverse history backwards to find unanswered user messages
    for (let i = history.length - 1; i >= 0; i--) {
      const message = history[i];

      // Stop when we hit the bot's last response
      if (message.authorPlatformId === botId) {
        break;
      }

      // Collect user message ID
      messageIds.unshift(message.id);
    }

    return messageIds;
  }
}
