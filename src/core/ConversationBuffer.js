import { createLogger } from "./logger.js";

const logger = createLogger("ConversationBuffer");

/**
 * Manages message buffering and debouncing.
 * Triggers processing after a period of inactivity.
 */
export class ConversationBuffer {
  /**
   * @param {import('./ChatFlow.js').ChatFlow} chatFlow
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(chatFlow, configManager) {
    this.chatFlow = chatFlow;
    this.configManager = configManager;
    this.buffers = new Map();
    this.BUFFER_TIMEOUT = this.configManager.get("conversation.bufferTimeout");
  }

  /**
   * Add a request to the buffer.
   * @param {string} channelId
   * @param {import('discord.js').TextBasedChannel} channel
   * @param {string} botId
   * @param {string} [cronMessage] - Cron job에서 전달되는 시스템 메시지 (선택)
   */
  add(channelId, channel, botId, cronMessage = null) {
    // Clear existing timer if any (user is still typing)
    if (this.buffers.has(channelId)) {
      clearTimeout(this.buffers.get(channelId));
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.buffers.delete(channelId);
      this.chatFlow.execute(channel, botId, cronMessage).catch((error) => {
        logger.error(
          { err: error, channelId },
          "ChatFlow error",
        );
      });
    }, this.BUFFER_TIMEOUT);

    this.buffers.set(channelId, timer);
  }

  /**
   * Clear buffer for a channel immediately (e.g. on manual trigger or command)
   * @param {string} channelId
   */
  clear(channelId) {
    if (this.buffers.has(channelId)) {
      clearTimeout(this.buffers.get(channelId));
      this.buffers.delete(channelId);
    }
  }

  /**
   * Clear all buffers. (graceful shutdown 시 호출)
   */
  clearAll() {
    for (const [, timer] of this.buffers) {
      clearTimeout(timer);
    }
    this.buffers.clear();
  }
}
