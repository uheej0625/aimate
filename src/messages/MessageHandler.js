import { createLogger } from "../core/logger.js";

const logger = createLogger("MessageHandler");

/**
 * Entry point for handling incoming messages.
 * Orchestrates flow: Filter -> Save -> Buffer
 *
 * @see ../application/contracts.js for the expected message shape
 */
export class MessageHandler {
  /**
   * @param {import('../messages/MessageService.js').MessageService} messageService
   * @param {import('../chat/ChatGenerationLifecycle.js').ChatGenerationLifecycle} generationLifecycle
   * @param {import('../chat/ConversationBuffer.js').ConversationBuffer} conversationBuffer
   * @param {import('../repositories/ChannelRepository.js').ChannelRepository} channelRepository
   * @param {import('../chat/ChatGenerationAbortRegistry.js').ChatGenerationAbortRegistry} generationAbortRegistry
   */
  constructor(
    messageService,
    generationLifecycle,
    conversationBuffer,
    channelRepository,
    generationAbortRegistry,
  ) {
    this.messageService = messageService;
    this.generationLifecycle = generationLifecycle;
    this.conversationBuffer = conversationBuffer;
    this.channelRepository = channelRepository;
    this.generationAbortRegistry = generationAbortRegistry;
  }

  /**
   * Handle a platform-neutral incoming message request.
   * @param {import('../application/contracts.js').IncomingMessageRequest} request
   */
  async handle({ message, channel, botId }) {
    try {
      // 1. Filter (봇 자신 / 빈 메시지 / 미활성화 채널 제외)
      if (!(await this.shouldHandle(message, botId))) return;

      // 2. Save user message immediately and get channel record
      const { channelRecord, changed } = await this.saveMessage(message);
      if (!changed) return;

      // 3. Cancel any processing generation for this channel
      // (New message interrupts previous generation context conceptually)
      this.generationAbortRegistry.abortChannel(channelRecord.id);
      await this.generationLifecycle.cancelActiveForChannel(channelRecord.id);

      // 4. Add to Buffer
      this.conversationBuffer.add({
        channelPort: channel,
        internalChannelId: channelRecord.id,
        botId,
      });
    } catch (error) {
      logger.error({ err: error }, "MessageHandler error");
    }
  }

  /**
   * Determine if the message should be handled.
   * 봇 자신·빈 메시지 필터링 + 채널 활성화 여부 확인을 함께 처리한다.
   * @param {Object} message
   * @param {string} botId - Bot's platform ID
   * @returns {Promise<boolean>}
   */
  async shouldHandle(message, botId) {
    if (message.author.isBot) return false;
    if (message.author.platformUserId === botId) return false;
    if (!message.content.trim()) return false;

    // 채널 레코드가 DB에 없으면 미활성화 채널로 간주
    if (this.channelRepository) {
      const channel = await this.channelRepository.findByPlatformId(
        message.platform,
        message.platformChannelId,
      );
      if (!channel) return false;
    }

    return true;
  }

  /**
   * Save a message to the database.
   * @param {import('../application/contracts.js').NormalizedMessage} message
   * @returns {Promise<Object>} The channel record
   */
  async saveMessage(message) {
    try {
      const { channel, changed } =
        await this.messageService.saveMessage(message);
      return { channelRecord: channel, changed };
    } catch (error) {
      logger.error({ err: error }, "Failed to save message");
      throw error;
    }
  }

  /**
   * Update an existing user message and refresh an affected response.
   * @param {import('../application/contracts.js').IncomingMessageRequest} request
   */
  async handleUpdate({ message, channel, botId }) {
    try {
      if (message.author.isBot || message.author.platformUserId === botId)
        return;

      const channelRecord = await this.channelRepository.findByPlatformId(
        message.platform,
        message.platformChannelId,
      );
      if (!channelRecord) return;

      const { changed } = await this.messageService.updateMessage(message);
      if (!changed) return;

      this.refreshBufferedResponse({ channel, channelRecord, botId });
    } catch (error) {
      logger.error({ err: error }, "MessageHandler update error");
    }
  }

  /**
   * Delete stored messages and refresh an affected response when at least one
   * deleted message belongs to a user.
   * @param {import('../application/contracts.js').MessageDeletionRequest} request
   */
  async handleDelete({ platform, platformMessageIds, channel, botId }) {
    try {
      const channelRecord = await this.channelRepository.findByPlatformId(
        platform,
        channel.platformChannelId,
      );
      const { deletedCount, deletedMessages } =
        await this.messageService.deleteMessages(platform, platformMessageIds);

      if (!channelRecord || deletedCount === 0) {
        return { deletedCount, refreshed: false };
      }

      const deletedUserMessage = deletedMessages.some(
        (message) => message.author?.platformId !== botId,
      );
      if (!deletedUserMessage) return { deletedCount, refreshed: false };

      const refreshed = this.refreshBufferedResponse({
        channel,
        channelRecord,
        botId,
      });
      return { deletedCount, refreshed };
    } catch (error) {
      logger.error({ err: error }, "MessageHandler delete error");
      return { deletedCount: 0, refreshed: false };
    }
  }

  refreshBufferedResponse({ channel, channelRecord, botId }) {
    const hadBufferedResponse = this.conversationBuffer.clear(channel);

    if (!hadBufferedResponse) return false;

    this.conversationBuffer.add({
      channelPort: channel,
      internalChannelId: channelRecord.id,
      botId,
    });
    return true;
  }
}
