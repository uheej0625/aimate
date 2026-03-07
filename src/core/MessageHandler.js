/**
 * Entry point for handling incoming messages.
 * Orchestrates flow: Save -> Filter -> Buffer
 *
 * @see docs/message-format.md for the expected message shape
 */
export class MessageHandler {
  /**
   * @param {import('../services/MessageService.js').MessageService} messageService
   * @param {import('../repositories/GenerationRepository.js').GenerationRepository} generationRepository
   * @param {import('./ConversationBuffer.js').ConversationBuffer} conversationBuffer
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
   * Handle an incoming Discord message.
   * @param {import('discord.js').Message} message
   */
  async handle(message) {
    try {
      // 1. Filter (봇 자신 / 빈 메시지 / 미활성화 채널 제외)
      if (!(await this.shouldHandle(message, message.client.user.id))) return;

      // 3. Save user message immediately and get channel record
      const channelRecord = await this.saveMessage(message);

      // 4. Cancel any processing generation for this channel
      // (New message interrupts previous generation context conceptually)
      await this.generationRepository.cancelProcessing(channelRecord.id);

      // 5. Add to Buffer
      this.conversationBuffer.add(
        message.channelId,
        message.channel,
        message.client.user.id,
      );
    } catch (error) {
      console.error("MessageHandler Error:", error);
    }
  }

  /**
   * Determine if the message should be handled.
   * 봇 자신·빈 메시지 필터링 + 채널 활성화 여부 확인을 함께 처리한다.
   * @param {Object} message
   * @param {string} botId - Bot's user ID
   * @returns {Promise<boolean>}
   */
  async shouldHandle(message, botId) {
    if (message.author.id === botId) return false;
    if (!message.content.trim()) return false;

    // 채널 레코드가 DB에 없으면 미활성화 채널로 간주
    if (this.channelRepository) {
      const channel = await this.channelRepository.findByPlatformId(
        message.platform,
        message.channelId,
      );
      if (!channel) return false;
    }

    return true;
  }

  /**
   * Save a message to the database.
   * @param {import('discord.js').Message} message
   * @returns {Promise<Object>} The channel record
   */
  async saveMessage(message) {
    try {
      const { channel } = await this.messageService.saveMessage(message);
      return channel;
    } catch (error) {
      console.error("Failed to save message:", error);
      throw error;
    }
  }
}
