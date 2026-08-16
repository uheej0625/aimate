/**
 * Service for message-related business logic.
 * Handles message persistence including related entities (channel, server, account).
 */
export class MessageService {
  /**
   * @param {import('../repositories/UserRepository.js').UserRepository} userRepository
   * @param {import('../repositories/PlatformAccountRepository.js').PlatformAccountRepository} platformAccountRepository
   * @param {import('../repositories/ChannelRepository.js').ChannelRepository} channelRepository
   * @param {import('../repositories/ServerRepository.js').ServerRepository} serverRepository
   * @param {import('../repositories/MessageRepository.js').MessageRepository} messageRepository
   */
  constructor(
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    messageRepository,
  ) {
    this.userRepository = userRepository;
    this.platformAccountRepository = platformAccountRepository;
    this.channelRepository = channelRepository;
    this.serverRepository = serverRepository;
    this.messageRepository = messageRepository;
  }

  /**
   * Save a message to the database with all related entities.
   * Automatically creates/updates server, channel, and platform account as needed.
   *
   * @param {import('../application/contracts.js').NormalizedMessage} message
   * @param {number} [generationId] - Optional generation ID to link message to
   * @param {Array} [attachments] - Optional structured attachment metadata
   * @returns {Promise<{message: Object, channel: Object, platformAccount: Object}>}
   */
  async saveMessage(message, generationId = null, attachments = []) {
    const platform = message.platform;

    // 1. Ensure server exists (if message is in a guild)
    let internalServerId = null;
    if (message.platformServerId) {
      const server = await this.serverRepository.upsert({
        platform: platform,
        platformId: message.platformServerId,
      });
      internalServerId = server.id;
    }

    // 2. Ensure channel exists
    const channel = await this.channelRepository.upsert({
      platform: platform,
      platformId: message.platformChannelId,
      serverId: internalServerId,
    });

    // 3. Find or create platform account
    let platformAccount = await this.platformAccountRepository.findByPlatformId(
      platform,
      message.author.platformUserId,
    );

    if (!platformAccount) {
      // Create new user first
      const user = await this.userRepository.create();

      // Create platform account
      platformAccount = await this.platformAccountRepository.upsert({
        platform: platform,
        platformId: message.author.platformUserId,
        userId: user.id,
        handle: message.author.handle,
        displayName: message.author.displayName,
      });
    } else {
      // Update existing platform account
      platformAccount = await this.platformAccountRepository.upsert({
        platform: platform,
        platformId: message.author.platformUserId,
        userId: platformAccount.userId,
        handle: message.author.handle,
        displayName: message.author.displayName,
      });
    }

    // 4. Save message
    const savedMessage = await this.messageRepository.save({
      platform: platform,
      platformId: message.platformMessageId,
      serverId: internalServerId,
      channelId: channel.id,
      authorId: platformAccount.id,
      content: message.content,
      attachmentsJson:
        attachments.length > 0 ? JSON.stringify(attachments) : null,
      generationId: generationId,
    });

    return {
      message: savedMessage,
      channel,
      platformAccount,
    };
  }
}
