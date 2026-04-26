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

    return await prisma.message.create({
      data: {
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
    const messages = await prisma.message.findMany({
      where: { channelId },
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

    return messages.reverse().map((message) => ({
      id: message.id,
      authorId: message.authorId,
      authorPlatformId: message.author?.platformId,
      content: message.content,
      createdAt: message.createdAt,
    }));
  }

  /**
   * Get chat history for a channel by Discord channel ID.
   * @param {string} discordChannelId - Discord channel ID
   * @param {number} limit - Maximum number of messages to retrieve
   * @returns {Promise<Array>}
   */
  async getHistoryByDiscordChannelId(
    discordChannelId,
    limit = this.configManager.get("conversation.maxContextMessages"),
  ) {
    const messages = await prisma.message.findMany({
      where: {
        channel: {
          platform: "discord",
          platformId: discordChannelId,
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

    return messages.reverse().map((message) => ({
      id: message.id,
      authorId: message.authorId,
      authorPlatformId: message.author?.platformId,
      content: message.content,
      createdAt: message.createdAt,
    }));
  }

  /**
   * Find a single message by platform and platformId, including its generation.
   * @param {string} platform - Platform name (e.g. "discord")
   * @param {string} platformId - Platform-specific message ID
   * @returns {Promise<Object|null>}
   */
  async findByPlatformId(platform, platformId) {
    return await prisma.message.findFirst({
      where: { platform, platformId },
      include: {
        generation: true,
        author: true,
      },
    });
  }

  /**
   * Delete messages for a specific channel.
   * @param {string} channelId - Channel ID
   * @returns {Promise<number>} Number of deleted messages
   */
  async deleteByChannel(channelId) {
    const result = await prisma.message.deleteMany({
      where: { channelId },
    });
    return result.count;
  }

  /**
   * Find messages by generationId.
   * @param {string} generationId
   * @returns {Promise<Array>}
   */
  async findByGenerationId(generationId) {
    return await prisma.message.findMany({
      where: { generationId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Delete a single message by platform and platformId.
   * Memory records linked to the message will have their messageId cleared first.
   * @param {string} platform - Platform name (e.g. "discord")
   * @param {string} platformId - Platform-specific message ID
   * @returns {Promise<boolean>} true if deleted, false if not found
   */
  async deleteByPlatformId(platform, platformId) {
    const message = await prisma.message.findFirst({
      where: { platform, platformId },
    });

    if (!message) return false;

    // Memory 관계 해제 후 메시지 삭제
    await prisma.memory.updateMany({
      where: { messageId: message.id },
      data: { messageId: null },
    });

    await prisma.message.delete({
      where: { id: message.id },
    });

    return true;
  }

  /**
   * Delete multiple messages by platform and platformIds.
   * @param {string} platform - Platform name (e.g. "discord")
   * @param {string[]} platformIds - Array of platform-specific message IDs
   * @returns {Promise<number>} Number of deleted messages
   */
  async deleteManyByPlatformIds(platform, platformIds) {
    if (!platformIds.length) return 0;

    const messages = await prisma.message.findMany({
      where: { platform, platformId: { in: platformIds } },
      select: { id: true },
    });

    if (!messages.length) return 0;

    const ids = messages.map((m) => m.id);

    await prisma.memory.updateMany({
      where: { messageId: { in: ids } },
      data: { messageId: null },
    });

    const result = await prisma.message.deleteMany({
      where: { id: { in: ids } },
    });

    return result.count;
  }
}
