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
   * @param {import('../repositories/GenerationRepository.js').GenerationRepository} generationRepository
   */
  constructor(
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    messageRepository,
    generationRepository,
  ) {
    this.userRepository = userRepository;
    this.platformAccountRepository = platformAccountRepository;
    this.channelRepository = channelRepository;
    this.serverRepository = serverRepository;
    this.messageRepository = messageRepository;
    this.generationRepository = generationRepository;
  }

  /**
   * Save a message to the database with all related entities.
   * Automatically creates/updates server, channel, and platform account as needed.
   *
   * @param {Object} message - Message object (from Discord.js or mock)
   * @param {number} [generationId] - Optional generation ID to link message to
   * @returns {Promise<{message: Object, channel: Object, platformAccount: Object}>}
   */
  async saveMessage(message, generationId = null) {
    const platform = message.platform;

    // 1. Ensure server exists (if message is in a guild)
    let serverId = null;
    if (message.guildId) {
      const server = await this.serverRepository.upsert({
        platform: platform,
        platformId: message.guildId,
      });
      serverId = server.id;
    }

    // 2. Ensure channel exists
    const channel = await this.channelRepository.upsert({
      platform: platform,
      platformId: message.channelId,
      serverId: serverId,
    });

    // 3. Find or create platform account
    let platformAccount = await this.platformAccountRepository.findByPlatformId(
      platform,
      message.author.id,
    );

    if (!platformAccount) {
      // Create new user first
      const user = await this.userRepository.create();

      // Create platform account
      platformAccount = await this.platformAccountRepository.upsert({
        platform: platform,
        platformId: message.author.id,
        userId: user.id,
        handle: message.author.username,
        displayName: message.author.globalName,
      });
    } else {
      // Update existing platform account
      platformAccount = await this.platformAccountRepository.upsert({
        platform: platform,
        platformId: message.author.id,
        userId: platformAccount.userId,
        handle: message.author.username,
        displayName: message.author.globalName,
      });
    }

    // 4. Save message
    const savedMessage = await this.messageRepository.save({
      platform: platform,
      platformId: message.id,
      serverId: serverId,
      channelId: channel.id,
      authorId: platformAccount.id,
      content: message.content,
      generationId: generationId,
    });

    // 5. Link to generation if provided
    if (generationId) {
      await this.generationRepository.appendMessage(
        generationId,
        savedMessage.id,
      );
    }

    return {
      message: savedMessage,
      channel,
      platformAccount,
    };
  }
}
