import { getRequiredCharacterId } from "../character/config.js";

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
   * @param {import('../repositories/EventRepository.js').EventRepository} eventRepository
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    messageRepository,
    eventRepository,
    configManager,
  ) {
    this.userRepository = userRepository;
    this.platformAccountRepository = platformAccountRepository;
    this.channelRepository = channelRepository;
    this.serverRepository = serverRepository;
    this.messageRepository = messageRepository;
    this.eventRepository = eventRepository;
    this.characterId = getRequiredCharacterId(configManager);
  }

  /**
   * Save a message to the database with all related entities.
   * Automatically creates/updates server, channel, and platform account as needed.
   *
   * @param {import('../application/contracts.js').NormalizedMessage} message
   * @param {number} [generationId] - Optional generation ID to link message to
   * @param {Array} [attachments] - Optional structured attachment metadata
   * @returns {Promise<{message: Object|null, channel: Object, platformAccount: Object, changed: boolean}>}
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
    const { message: savedMessage, changed } =
      await this.recordMessageObservation({
        platform,
        platformId: message.platformMessageId,
        serverId: internalServerId,
        channelId: channel.id,
        authorId: platformAccount.id,
        content: message.content,
        attachmentsJson:
          attachments.length > 0 ? JSON.stringify(attachments) : null,
        generationId,
      });

    return {
      message: savedMessage,
      channel,
      platformAccount,
      changed,
    };
  }

  /**
   * Update a stored message without creating a missing row.
   * @param {import('../application/contracts.js').NormalizedMessage} message
   * @returns {Promise<{message: Object|null, changed: boolean}>}
   */
  async updateMessage(message) {
    return await this.messageRepository.transaction(async (tx) => {
      const existing = await this.messageRepository.findByPlatformIdInTransaction(
        tx,
        message.platform,
        message.platformMessageId,
      );
      if (
        !existing ||
        existing.deletedAt ||
        existing.content === message.content
      ) {
        return { message: existing, changed: false };
      }

      const latestEvent = await this.findLatestEvent(tx, message);
      const updated = await this.messageRepository.updateContentInTransaction(
        tx,
        existing.id,
        message.content,
      );
      await this.createEvent(tx, {
        channelId: existing.channelId,
        messageId: existing.id,
        platform: message.platform,
        platformMessageId: message.platformMessageId,
        operation: "UPDATE",
        snapshotContent: message.content,
        snapshotAttachmentsJson: existing.attachmentsJson,
        generationId: latestEvent?.generationId ?? null,
      });
      return { message: updated, changed: true };
    });
  }

  /**
   * Delete stored platform messages and return the rows that existed.
   * @param {string} platform
   * @param {string[]} platformMessageIds
   * @param {string|null} [channelId]
   * @returns {Promise<{deletedCount: number, deletedMessages: Array}>}
   */
  async deleteMessages(platform, platformMessageIds, channelId = null) {
    return await this.messageRepository.transaction(async (tx) => {
      const deletedMessages =
        await this.messageRepository.findActiveByPlatformIdsInTransaction(
          tx,
          platform,
          platformMessageIds,
        );
      await this.recordDeleteEvents(tx, deletedMessages);

      if (channelId) {
        const foundIds = new Set(
          deletedMessages.map((message) => message.platformId),
        );
        for (const platformMessageId of platformMessageIds) {
          if (foundIds.has(platformMessageId)) continue;

          const latestEvent = await this.eventRepository.findLatestForMessage(
            tx,
            {
              characterId: this.characterId,
              platform,
              platformMessageId,
            },
          );
          if (latestEvent?.operation === "DELETE") continue;

          await this.createEvent(tx, {
            channelId,
            platform,
            platformMessageId,
            operation: "DELETE",
          });
        }
      }

      const deletedCount =
        await this.messageRepository.softDeleteByIdsInTransaction(
          tx,
          deletedMessages.map((message) => message.id),
        );
      return { deletedCount, deletedMessages };
    });
  }

  async deleteMessage(platform, platformMessageId) {
    const { deletedCount } = await this.deleteMessages(platform, [
      platformMessageId,
    ]);
    return deletedCount === 1;
  }

  async deleteMessagesByChannel(channelId) {
    return await this.messageRepository.transaction(async (tx) => {
      const messages =
        await this.messageRepository.findActiveByChannelInTransaction(
          tx,
          channelId,
        );
      await this.recordDeleteEvents(tx, messages);
      return await this.messageRepository.softDeleteByIdsInTransaction(
        tx,
        messages.map((message) => message.id),
      );
    });
  }

  async recordMessageObservation(messageData) {
    return await this.messageRepository.transaction(async (tx) => {
      const existing = await this.messageRepository.findByPlatformIdInTransaction(
        tx,
        messageData.platform,
        messageData.platformId,
      );
      if (existing?.deletedAt) return { message: existing, changed: false };

      const latestEvent = await this.findLatestEvent(tx, messageData);
      if (!existing && latestEvent?.operation === "DELETE") {
        return { message: null, changed: false };
      }

      const changed =
        !existing ||
        existing.content !== messageData.content ||
        existing.attachmentsJson !== messageData.attachmentsJson ||
        (messageData.generationId !== null &&
          existing.generationId !== messageData.generationId);
      if (!changed) return { message: existing, changed: false };

      const saved = await this.messageRepository.upsertInTransaction(
        tx,
        messageData,
      );
      const contentChanged =
        !existing ||
        existing.content !== messageData.content ||
        existing.attachmentsJson !== messageData.attachmentsJson;
      if (contentChanged) {
        await this.createEvent(tx, {
          channelId: messageData.channelId,
          messageId: saved.id,
          platform: messageData.platform,
          platformMessageId: messageData.platformId,
          operation: existing ? "UPDATE" : "CREATE",
          snapshotContent: messageData.content,
          snapshotAttachmentsJson: messageData.attachmentsJson,
          generationId: existing
            ? (latestEvent?.generationId ?? null)
            : messageData.generationId,
        });
      }
      return { message: saved, changed: true };
    });
  }

  async recordDeleteEvents(tx, messages) {
    for (const message of messages) {
      const latestEvent = await this.findLatestEvent(tx, message);
      if (latestEvent?.operation === "DELETE") continue;

      await this.createEvent(tx, {
        channelId: message.channelId,
        messageId: message.id,
        platform: message.platform,
        platformMessageId: message.platformId,
        operation: "DELETE",
        snapshotContent: message.content,
        snapshotAttachmentsJson: message.attachmentsJson,
        generationId: latestEvent?.generationId ?? null,
      });
    }
  }

  async findLatestEvent(tx, { platform, platformId }) {
    return await this.eventRepository.findLatestForMessage(tx, {
      characterId: this.characterId,
      platform,
      platformMessageId: platformId,
    });
  }

  async createEvent(tx, eventData) {
    return await this.eventRepository.create(tx, {
      characterId: this.characterId,
      ...eventData,
    });
  }
}
