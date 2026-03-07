export class ContextService {
  /**
   * @param {import('../repositories/MessageRepository.js').MessageRepository} messageRepository
   */
  constructor(messageRepository) {
    this.messageRepository = messageRepository;
  }

  /**
   * Build the full context for AI generation, including history and system prompt.
   * @param {string} channelId - Internal channel ID
   * @param {string} botId - Bot's platform user ID (platformId)
   * @param {string} [cronMessage] - Cron job에서 전달되는 시스템 메시지 (선택)
   * @returns {Promise<{context: Array, messageIds: Array<string>}>}
   */
  async buildContext(channelId, botId, cronMessage = null) {
    const context = [];

    context.push({
      role: "user",
      content: `[Context] Current date: ${new Date().toLocaleString()}`,
    });

    context.push({
      role: "user",
      content: `[Context] 처음보는 유저로부터 새로운 대화가 시작되었습니다.`,
    });

    const history = await this.messageRepository.getHistory(channelId);

    for (const message of history) {
      context.push({
        role: message.authorPlatformId === botId ? "assistant" : "user",
        content: message.content,
      });
    }

    // Cron 메시지가 있으면 컨텍스트 마지막에 추가
    if (cronMessage) {
      context.push({
        role: "user",
        content: cronMessage,
      });
    }

    const messageIds = this.extractPendingMessageIds(history, botId);

    return { context, messageIds };
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
