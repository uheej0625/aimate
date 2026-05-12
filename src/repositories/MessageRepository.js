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

    return await prisma.message.upsert({
      where: {
        platform_platformId: {
          platform,
          platformId,
        },
      },
      update: {
        content,
        attachmentsJson,
        generationId,
      },
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

    return await this._toHistoryMessages(messages.reverse());
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

    return await this._toHistoryMessages(messages.reverse());
  }

  async addGenerationId(messageId, generationId) {
    await prisma.message.update({
      where: { id: messageId },
      data: { generationId },
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
      where: { platform, platformId },
      include: {
        generation: true,
        author: true,
      },
    });
  }

  /**
   * Delete messages for a specific channel.
   * Memory records linked to the messages will have their messageId cleared first.
   * @param {string} channelId - Channel ID
   * @returns {Promise<number>} Number of deleted messages
   */
  async deleteByChannel(channelId) {
    const messages = await prisma.message.findMany({
      where: { channelId },
      select: { id: true },
    });

    if (!messages.length) return 0;
    const ids = messages.map((m) => m.id);

    const [_, result] = await prisma.$transaction([
      prisma.memory.updateMany({
        where: { messageId: { in: ids } },
        data: { messageId: null },
      }),
      prisma.message.deleteMany({
        where: { channelId },
      }),
    ]);

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
    await prisma.$transaction([
      prisma.memory.updateMany({
        where: { messageId: message.id },
        data: { messageId: null },
      }),
      prisma.message.delete({
        where: { id: message.id },
      }),
    ]);

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

    const [_, result] = await prisma.$transaction([
      prisma.memory.updateMany({
        where: { messageId: { in: ids } },
        data: { messageId: null },
      }),
      prisma.message.deleteMany({
        where: { id: { in: ids } },
      }),
    ]);

    return result.count;
  }

  async _toHistoryMessages(messages) {
    const generationIds = [
      ...new Set(
        messages.flatMap((message) =>
          this._parseAttachments(message.attachmentsJson)
            .filter((attachment) => attachment?.type === "generated_image")
            .map((attachment) => attachment.generationId)
            .filter(Boolean),
        ),
      ),
    ];

    const generations = generationIds.length
      ? await prisma.generation.findMany({
          where: { id: { in: generationIds } },
          select: { id: true, input: true },
        })
      : [];
    const promptByGenerationId = new Map(
      generations.map((generation) => [generation.id, generation.input]),
    );

    return messages.map((message) =>
      this._toHistoryMessage(message, promptByGenerationId),
    );
  }

  _toHistoryMessage(message, promptByGenerationId = new Map()) {
    return {
      id: message.id,
      authorId: message.authorId,
      authorPlatformId: message.author?.platformId,
      content: this._renderContentForAI(message, promptByGenerationId),
      createdAt: message.createdAt,
    };
  }

  _renderContentForAI(message, promptByGenerationId = new Map()) {
    const content = message.content || "";
    const attachments = this._parseAttachments(message.attachmentsJson);
    const generatedImages = attachments.filter(
      (attachment) =>
        attachment?.type === "generated_image" && attachment.imageId,
    );

    if (generatedImages.length === 0) {
      return content;
    }

    const imageLines = generatedImages.map((image) => {
      const prompt =
        promptByGenerationId.get(image.generationId) || image.prompt;
      const promptLine = prompt ? ` Prompt: ${prompt}` : "";
      return `- [IMAGE:${image.imageId}] (${image.filename || `${image.imageId}.png`}).${promptLine}`;
    });

    return [content, "Attached generated images:", ...imageLines]
      .filter(Boolean)
      .join("\n");
  }

  _parseAttachments(attachmentsJson) {
    if (!attachmentsJson) return [];

    try {
      const parsed = JSON.parse(attachmentsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
