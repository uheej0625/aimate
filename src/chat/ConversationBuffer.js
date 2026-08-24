import { createLogger } from "../core/logger.js";

const logger = createLogger("ConversationBuffer");

/**
 * Manages message buffering and debouncing.
 * Triggers processing after a period of inactivity.
 */
export class ConversationBuffer {
  /**
   * @param {import('../chat/ChatFlow.js').ChatFlow} chatFlow
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
   * @param {import('../application/contracts.js').ConversationRequest} request
   */
  add(request) {
    const key = this.getKey(request.channelPort);

    // Clear existing timer if any (user is still typing)
    if (this.buffers.has(key)) {
      clearTimeout(this.buffers.get(key));
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.buffers.delete(key);
      this.chatFlow.execute(request).catch((error) => {
        logger.error(
          {
            err: error,
            platform: request.channelPort.platform,
            platformChannelId: request.channelPort.platformChannelId,
          },
          "ChatFlow error",
        );
      });
    }, this.BUFFER_TIMEOUT);

    this.buffers.set(key, timer);
  }

  /**
   * Clear buffer for a channel immediately (e.g. on manual trigger or command)
   * @param {import('../application/contracts.js').ChannelPort} channel
   */
  clear(channel) {
    const key = this.getKey(channel);

    if (this.buffers.has(key)) {
      clearTimeout(this.buffers.get(key));
      this.buffers.delete(key);
    }
  }

  getKey(channelPort) {
    return `${channelPort.platform}:${channelPort.platformChannelId}`;
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
