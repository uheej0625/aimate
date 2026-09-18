import { prisma } from "../database/client.js";

/**
 * Repository for Message database operations.
 * Handles all message-related data access.
 */
export class MessageRepository {
  /**
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(configManager) {
    this.configManager = configManager;
  }

  get characterId() {
    return this.configManager.get("character");
  }
  /**
   * Save a Discord message to the database.
   * @param {Object} messageData - Message data to save
   * @returns {Promise<Object>}
   */
  async save(messageData) {
    const {
      platform = "discord",
      platformId,
      serverId = null,
      channelId,
      authorId,
      content,
      attachmentsJson = null,
      generationId = null,
    } = messageData;

    return await prisma.$transaction(async (tx) => {
      const where = {
        platform_platformId: {
          platform,
          platformId,
        },
      };
      const existing = await tx.message.findUnique({ where });
      if (existing?.deletedAt) return { message: existing, changed: false };

      const latestEvent = await this.findLatestEvent(
        tx,
        platform,
        platformId,
      );
      if (!existing && latestEvent?.operation === "DELETE") {
        return { message: null, changed: false };
      }
      const update = {
        content,
        attachmentsJson,
        ...(generationId !== null ? { generationId } : {}),
      };
      const changed =
        !existing ||
        existing.content !== content ||
        existing.attachmentsJson !== attachmentsJson ||
        (generationId !== null && existing.generationId !== generationId);

      if (!changed) return { message: existing, changed: false };

      const message = await tx.message.upsert({
        where,
        update,
        create: {
          platform,
          platformId,
          serverId,
          channelId,
          authorId,
          content,
          attachmentsJson,
          generationId,
        },
      });

      const observedContentChanged =
        !existing ||
        existing.content !== content ||
        existing.attachmentsJson !== attachmentsJson;

      if (observedContentChanged) {
        await this.createEvent(tx, {
          platform,
          platformId,
          channelId,
          messageId: message.id,
          operation: existing ? "UPDATE" : "CREATE",
          snapshotContent: content,
          snapshotAttachmentsJson: attachmentsJson,
          generationId: existing
            ? (latestEvent?.generationId ?? null)
            : generationId,
        });
      }

      return { message, changed };
    });
  }

  /**
   * Update the mutable content of an existing platform message.
   * Missing, deleted and unchanged messages are reported without writing.
   * @param {string} platform
   * @param {string} platformId
   * @param {string} content
   * @returns {Promise<{message: Object|null, changed: boolean}>}
   */
  async updateContent(platform, platformId, content) {
    return await prisma.$transaction(async (tx) => {
      const where = {
        platform_platformId: {
          platform,
          platformId,
        },
      };
      const existing = await tx.message.findUnique({
        where,
      });

      if (!existing || existing.deletedAt || existing.content === content) {
        return { message: existing, changed: false };
      }

      const message = await tx.message.update({
        where,
        data: { content },
      });
      const latestEvent = await this.findLatestEvent(
        tx,
        platform,
        platformId,
      );
      await this.createEvent(tx, {
        platform,
        platformId,
        channelId: existing.channelId,
        messageId: existing.id,
        operation: "UPDATE",
        snapshotContent: content,
        snapshotAttachmentsJson: existing.attachmentsJson,
        generationId: latestEvent?.generationId ?? null,
      });
      return { message, changed: true };
    });
  }

  /**
   * Get chat history for a channel.
   * @param {string} channelId - Internal channel ID
   * @param {number} limit - Maximum number of messages to retrieve
   * @returns {Promise<Array>}
   */
  async getHistory(
    channelId,
    limit = this.configManager.get("conversation.maxContextMessages"),
  ) {
    return await this.getHistoryRecords(channelId, limit);
  }

  async getHistoryRecords(
    channelId,
    limit = this.configManager.get("conversation.maxContextMessages"),
  ) {
    const messages = await prisma.message.findMany({
      where: { channelId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        author: {
          include: {
            user: true,
          },
        },
      },
    });

    return messages.reverse();
  }

  /**
   * Get chat history for a channel by platform and platform channel ID.
   * @param {string} platform - Platform name (e.g. "discord", "cli")
   * @param {string} platformChannelId - Platform-specific channel ID
   * @param {number} limit - Maximum number of messages to retrieve
   * @returns {Promise<Array>}
   */
  async getHistoryByPlatformChannelId(
    platform,
    platformChannelId,
    limit = this.configManager.get("conversation.maxContextMessages"),
  ) {
    const messages = await prisma.message.findMany({
      where: {
        deletedAt: null,
        channel: {
          platform,
          platformId: platformChannelId,
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        author: {
          include: {
            user: true,
          },
        },
      },
    });

    return messages.reverse();
  }

  async addGenerationId(messageId, generationId) {
    await prisma.message.update({
      where: { id: messageId, deletedAt: null },
      data: { generationId },
    });
  }

  /**
   * @param {number} messageId
   * @returns {Promise<Object|null>}
   */
  async findById(messageId) {
    return await prisma.message.findUnique({
      where: { id: messageId, deletedAt: null },
    });
  }

  /**
   * Find a single message by platform and platformId, including its generation.
   * @param {string} platform - Platform name (e.g. "discord")
   * @param {string} platformId - Platform-specific message ID
   * @returns {Promise<Object|null>}
   */
  async findByPlatformId(platform, platformId) {
    return await prisma.message.findFirst({
      where: { platform, platformId, deletedAt: null },
      include: {
        generation: true,
        author: true,
      },
    });
  }

  /**
   * Find messages by their platform IDs, including their authors.
   * @param {string} platform
   * @param {string[]} platformIds
   * @returns {Promise<Array>}
   */
  async findManyByPlatformIds(platform, platformIds) {
    if (!platformIds.length) return [];

    return await prisma.message.findMany({
      where: { platform, platformId: { in: platformIds }, deletedAt: null },
      include: { author: true },
    });
  }

  /**
   * Soft delete messages for a specific channel, preserving their references.
   * @param {string} channelId - Channel ID
   * @returns {Promise<number>} Number of deleted messages
   */
  async deleteByChannel(channelId) {
    return await prisma.$transaction(async (tx) => {
      const messages = await tx.message.findMany({
        where: { channelId, deletedAt: null },
      });

      if (!messages.length) return 0;
      const ids = messages.map((message) => message.id);

      await this.createDeleteEvents(tx, messages);
      const result = await tx.message.updateMany({
        where: { id: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      return result.count;
    });
  }

  /**
   * Find messages by generationId.
   * @param {string} generationId
   * @returns {Promise<Array>}
   */
  async findByGenerationId(generationId) {
    return await prisma.message.findMany({
      where: { generationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Soft delete a message by platform and platformId, preserving its references.
   * @param {string} platform - Platform name (e.g. "discord")
   * @param {string} platformId - Platform-specific message ID
   * @returns {Promise<boolean>} true if deleted, false if not found
   */
  async deleteByPlatformId(platform, platformId) {
    return await prisma.$transaction(async (tx) => {
      const message = await tx.message.findFirst({
        where: { platform, platformId, deletedAt: null },
      });

      if (!message) return false;

      await this.createDeleteEvents(tx, [message]);
      await tx.message.update({
        where: { id: message.id },
        data: { deletedAt: new Date() },
      });

      return true;
    });
  }

  /**
   * Soft delete multiple messages by platform and platformIds.
   * @param {string} platform - Platform name (e.g. "discord")
   * @param {string[]} platformIds - Array of platform-specific message IDs
   * @returns {Promise<number>} Number of deleted messages
   */
  async deleteManyByPlatformIds(platform, platformIds, channelId = null) {
    if (!platformIds.length) return 0;

    return await prisma.$transaction(async (tx) => {
      const messages = await tx.message.findMany({
        where: { platform, platformId: { in: platformIds } },
      });
      const activeMessages = messages.filter((message) => !message.deletedAt);
      const ids = activeMessages.map((message) => message.id);

      await this.createDeleteEvents(tx, activeMessages);

      if (channelId) {
        const foundIds = new Set(messages.map((message) => message.platformId));
        for (const platformId of platformIds) {
          if (foundIds.has(platformId)) continue;

          const latestEvent = await this.findLatestEvent(
            tx,
            platform,
            platformId,
          );
          if (latestEvent?.operation === "DELETE") continue;

          await this.createEvent(tx, {
            platform,
            platformId,
            channelId,
            operation: "DELETE",
          });
        }
      }

      if (!ids.length) return 0;

      const result = await tx.message.updateMany({
        where: { id: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      return result.count;
    });
  }

  async createDeleteEvents(tx, messages) {
    for (const message of messages) {
      const latestEvent = await this.findLatestEvent(
        tx,
        message.platform,
        message.platformId,
      );
      if (latestEvent?.operation === "DELETE") continue;

      await this.createEvent(tx, {
        platform: message.platform,
        platformId: message.platformId,
        channelId: message.channelId,
        messageId: message.id,
        operation: "DELETE",
        snapshotContent: message.content,
        snapshotAttachmentsJson: message.attachmentsJson,
        generationId: latestEvent?.generationId ?? null,
      });
    }
  }

  async findLatestEvent(tx, platform, platformId) {
    return await tx.event.findFirst({
      where: { platform, platformMessageId: platformId },
      orderBy: { id: "desc" },
    });
  }

  async createEvent(
    tx,
    {
      platform,
      platformId,
      channelId,
      messageId = null,
      operation,
      snapshotContent = null,
      snapshotAttachmentsJson = null,
      generationId = null,
    },
  ) {
    return await tx.event.create({
      data: {
        characterId: this.characterId,
        channelId,
        messageId,
        platform,
        platformMessageId: platformId,
        operation,
        snapshotContent,
        snapshotAttachmentsJson,
        generationId,
      },
    });
  }

  async findGenerationInputsByIds(generationIds) {
    if (!generationIds.length) return new Map();

    const generations = await prisma.generation.findMany({
      where: { id: { in: generationIds } },
      select: { id: true, input: true },
    });

    return new Map(
      generations.map((generation) => [generation.id, generation.input]),
    );
  }
}
