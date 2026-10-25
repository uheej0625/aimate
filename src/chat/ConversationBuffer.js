import { createLogger, elapsedMs, withLogContext } from "../core/logger.js";

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
  constructor(chatFlow, configManager, conversationSession) {
    this.chatFlow = chatFlow;
    this.configManager = configManager;
    this.conversationSession = conversationSession;
    this.buffers = new Map();
    this.BUFFER_TIMEOUT = this.configManager.get("conversation.bufferTimeout");
  }

  /**
   * Add a request to the buffer.
   * @param {import('../application/contracts.js').ConversationRequest} request
   */
  async add(request) {
    if (request.turnId) return this.schedule(request);
    const key = this.getKey(request.channelPort);
    return await this.conversationSession.run(key, () =>
      this.schedule({
        ...request,
        turnId: this.conversationSession.begin(key),
      }),
    );
  }

  schedule(request) {
    const key = this.getKey(request.channelPort);
    const fields = {
      platform: request.channelPort.platform,
      platformChannelId: request.channelPort.platformChannelId,
      channelId: request.internalChannelId,
      turnId: request.turnId,
    };
    const scheduledAt = performance.now();
    logger.debug(
      {
        ...fields,
        event: "buffer.scheduled",
        replaced: this.buffers.has(key),
        timeoutMs: this.BUFFER_TIMEOUT,
      },
      "Conversation buffer scheduled",
    );

    // Clear existing timer if any (user is still typing)
    if (this.buffers.has(key)) {
      clearTimeout(this.buffers.get(key).timer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.buffers.delete(key);
      logger.debug(
        {
          ...fields,
          event: "buffer.fired",
          durationMs: elapsedMs(scheduledAt),
        },
        "Conversation buffer fired",
      );
      withLogContext(fields, () => this.chatFlow.execute(request)).catch(
        (error) => {
          logger.error(
            {
              err: error,
              ...fields,
              event: "buffer.execution.failed",
            },
            "ChatFlow error",
          );
        },
      );
    }, this.BUFFER_TIMEOUT);

    this.buffers.set(key, { timer, turnId: request.turnId });
  }

  /**
   * @param {import('../application/contracts.js').ChannelPort} channel
   * @returns {boolean}
   */
  has(channel) {
    return this.buffers.has(this.getKey(channel));
  }

  /**
   * Clear buffer for a channel immediately (e.g. on manual trigger or command)
   * @param {import('../application/contracts.js').ChannelPort} channel
   */
  clear(channel) {
    const key = this.getKey(channel);

    if (this.buffers.has(key)) {
      const { timer, turnId } = this.buffers.get(key);
      clearTimeout(timer);
      this.buffers.delete(key);
      this.conversationSession.settle(key, turnId);
      logger.debug(
        {
          event: "buffer.cleared",
          platform: channel.platform,
          platformChannelId: channel.platformChannelId,
          turnId,
        },
        "Conversation buffer cleared",
      );
      return true;
    }

    return false;
  }

  getKey(channelPort) {
    return JSON.stringify([
      channelPort.platform,
      channelPort.platformChannelId,
    ]);
  }

  /**
   * Clear all buffers. (graceful shutdown 시 호출)
   */
  clearAll() {
    const count = this.buffers.size;
    for (const { timer } of this.buffers.values()) {
      clearTimeout(timer);
    }
    this.buffers.clear();
    this.conversationSession.clearAll();
    logger.debug(
      { event: "buffer.cleared_all", count },
      "Conversation buffers cleared",
    );
  }
}
