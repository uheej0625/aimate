import { randomUUID } from "node:crypto";
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
  async saveMessage(
    message,
    generationId = null,
    attachments = [],
    observation = {},
  ) {
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
      await this.recordMessageObservation(
        {
          platform,
          platformId: message.platformMessageId,
          serverId: internalServerId,
          channelId: channel.id,
          authorId: platformAccount.id,
          content: message.content,
          attachmentsJson:
            attachments.length > 0 ? JSON.stringify(attachments) : null,
          generationId,
          editedAt: message.editedAt ?? null,
          isBot: message.author.isBot,
        },
        observation,
      );

    return {
      message: savedMessage,
      channel,
      platformAccount,
      changed,
    };
  }

  async updateMessage(
    message,
    { observed = false, observedAt = new Date() } = {},
  ) {
    const result = await this.messageRepository.transaction(async (tx) => {
      const existing =
        await this.messageRepository.findByPlatformIdInTransaction(
          tx,
          message.platform,
          message.platformMessageId,
        );
      if (!existing || existing.deletedAt || isOlder(message, existing)) {
        return { message: existing, changed: false };
      }
      const changed = existing.content !== message.content;
      const editedAt = message.editedAt ?? existing.editedAt;
      if (!changed && sameDate(existing.editedAt, editedAt)) {
        return { message: existing, changed: false };
      }
      const updated = await this.messageRepository.updateContentInTransaction(
        tx,
        existing.id,
        message.content,
        editedAt,
      );
      if (observed && changed) {
        const latest = await this.findLatestEvent(tx, existing);
        await this.createEvent(tx, {
          ...this.eventIdentity(existing),
          kind: "EDIT",
          snapshotContent: message.content,
          snapshotAttachmentsJson: existing.attachmentsJson,
          previousContent: latest?.snapshotContent ?? null,
          generationId: latest?.generationId ?? null,
          editedAt,
          observedAt,
        });
      }
      return { message: updated, changed };
    });
    if (result.message !== null) return result;
    // A complete update can be the first time this application sees a message.
    return await this.saveMessage(message, null, [], {
      observed,
      observedAt,
      kind: "EDIT",
    });
  }

  async deleteMessages(
    platform,
    platformMessageIds,
    channelId = null,
    { observed = false, observedAt = new Date() } = {},
  ) {
    const ids = [...new Set(platformMessageIds)];
    return await this.messageRepository.transaction(async (tx) => {
      const deletedMessages =
        await this.messageRepository.findActiveByPlatformIdsInTransaction(
          tx,
          platform,
          ids,
        );
      const batchId = ids.length > 1 ? randomUUID() : null;
      if (observed) {
        for (const message of deletedMessages) {
          const latest = await this.findLatestEvent(tx, message);
          await this.createEvent(tx, {
            ...this.eventIdentity(message),
            kind: "DELETE",
            // The latest database content may never have been seen.
            snapshotContent: latest?.snapshotContent ?? null,
            snapshotAttachmentsJson: latest?.snapshotAttachmentsJson ?? null,
            generationId: latest?.generationId ?? null,
            batchId,
            observedAt,
          });
        }
      }
      const deletedCount =
        await this.messageRepository.softDeleteByIdsInTransaction(
          tx,
          deletedMessages.map((message) => message.id),
        );
      if (channelId) {
        for (const id of ids) {
          await this.messageRepository.rememberDeletion(
            tx,
            platform,
            id,
            channelId,
          );
        }
      }
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
      return await this.messageRepository.softDeleteByIdsInTransaction(
        tx,
        messages.map((message) => message.id),
      );
    });
  }

  async recordMessageObservation(
    messageData,
    {
      observed = true,
      observedAt = new Date(),
      kind = messageData.isBot ? "SENT" : "READ",
    } = {},
  ) {
    return await this.messageRepository.transaction(async (tx) => {
      const existing =
        await this.messageRepository.findByPlatformIdInTransaction(
          tx,
          messageData.platform,
          messageData.platformId,
        );
      // A CREATE delivery is not an update; late duplicates cannot roll back edits.
      const confirmedDeletedOutput =
        messageData.isBot && existing?.deletedAt && !existing.authorId;
      if (existing && !confirmedDeletedOutput)
        return { message: existing, changed: false };
      const saved = await this.messageRepository.upsertInTransaction(
        tx,
        messageData,
      );
      if (observed) {
        await this.createEvent(tx, {
          ...this.eventIdentity(saved),
          kind,
          snapshotContent: messageData.content,
          snapshotAttachmentsJson: messageData.attachmentsJson,
          generationId: messageData.isBot ? messageData.generationId : null,
          editedAt: messageData.editedAt,
          observedAt,
        });
      }
      return { message: saved, changed: true };
    });
  }

  eventIdentity(message) {
    return {
      channelId: message.channelId,
      messageId: message.id,
      platform: message.platform,
      platformMessageId: message.platformId,
    };
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

function sameDate(a, b) {
  return (
    (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null)
  );
}

function isOlder(message, existing) {
  return (
    existing.editedAt &&
    (!message.editedAt || new Date(message.editedAt) < existing.editedAt)
  );
}
