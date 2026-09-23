import { prisma } from "../database/client.js";

/**
 * Repository for Message database operations.
 */
export class MessageRepository {
  /**
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(configManager) {
    this.configManager = configManager;
  }

  async transaction(callback) {
    return await prisma.$transaction(callback);
  }

  async findByPlatformIdInTransaction(tx, platform, platformId) {
    return await tx.message.findUnique({
      where: {
        platform_platformId: {
          platform,
          platformId,
        },
      },
    });
  }

  async upsertInTransaction(tx, messageData) {
    const {
      platform,
      platformId,
      serverId,
      channelId,
      authorId,
      content,
      attachmentsJson,
      generationId,
      editedAt = null,
      isBot = false,
    } = messageData;
    const where = {
      platform_platformId: {
        platform,
        platformId,
      },
    };

    return await tx.message.upsert({
      where,
      update: {
        content,
        attachmentsJson,
        editedAt,
        authorId,
        isBot,
        ...(generationId !== null ? { generationId } : {}),
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
        editedAt,
        isBot,
      },
    });
  }

  async updateContentInTransaction(tx, messageId, content, editedAt = null) {
    return await tx.message.update({
      where: { id: messageId },
      data: { content, editedAt },
    });
  }

  async findActiveByPlatformIdsInTransaction(tx, platform, platformIds) {
    if (!platformIds.length) return [];

    return await tx.message.findMany({
      where: {
        platform,
        platformId: { in: platformIds },
        deletedAt: null,
      },
      include: { author: true },
    });
  }

  async findActiveByChannelInTransaction(tx, channelId) {
    return await tx.message.findMany({
      where: { channelId, deletedAt: null },
    });
  }

  async softDeleteByIdsInTransaction(tx, messageIds) {
    if (!messageIds.length) return 0;

    const result = await tx.message.updateMany({
      where: { id: { in: messageIds }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  async rememberDeletion(tx, platform, platformId, channelId) {
    return await tx.message.upsert({
      where: { platform_platformId: { platform, platformId } },
      update: {},
      create: {
        platform,
        platformId,
        channelId,
        content: "",
        deletedAt: new Date(),
      },
    });
  }

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
    await prisma.message.updateMany({
      where: { id: messageId, deletedAt: null },
      data: { generationId },
    });
  }

  async findById(messageId) {
    return await prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
    });
  }

  async findByPlatformId(platform, platformId) {
    return await prisma.message.findFirst({
      where: { platform, platformId, deletedAt: null },
      include: {
        generation: true,
        author: true,
      },
    });
  }

  async findManyByPlatformIds(platform, platformIds) {
    if (!platformIds.length) return [];

    return await prisma.message.findMany({
      where: { platform, platformId: { in: platformIds }, deletedAt: null },
      include: { author: true },
    });
  }

  async findByGenerationId(generationId) {
    return await prisma.message.findMany({
      where: { generationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
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
