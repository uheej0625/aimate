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
   * @param {import('../repositories/GenerationRepository.js').GenerationRepository} generationRepository
   * @param {import('../chat/ConversationBuffer.js').ConversationBuffer} conversationBuffer
   * @param {import('../repositories/ChannelRepository.js').ChannelRepository} channelRepository
   */
  constructor(
    messageService,
    generationRepository,
    conversationBuffer,
    channelRepository,
  ) {
    this.messageService = messageService;
    this.generationRepository = generationRepository;
    this.conversationBuffer = conversationBuffer;
    this.channelRepository = channelRepository;
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
      const channelRecord = await this.saveMessage(message);

      // 3. Cancel any processing generation for this channel
      // (New message interrupts previous generation context conceptually)
      await this.generationRepository.cancelProcessing(channelRecord.id);

      // 4. Add to Buffer
      this.conversationBuffer.add({ channel, botId });
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
      const { channel } = await this.messageService.saveMessage(message);
      return channel;
    } catch (error) {
      logger.error({ err: error }, "Failed to save message");
      throw error;
    }
  }
}
