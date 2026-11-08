import { prisma } from "../database/client.js";
import { getRequiredCharacterId } from "../character/config.js";

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
      sentAt = null,
      isBot = false,
    } = messageData;
    const where = {
      platform_platformId: {
        platform,
        platformId,
      },
    };

    const existing = await tx.message.findUnique({ where });
    const channelMessageNo =
      existing?.channelMessageNo ?? (await this.allocateNumber(tx, channelId));

    return await tx.message.upsert({
      where,
      update: {
        content,
        attachmentsJson,
        editedAt,
        authorId,
        isBot,
        ...(generationId !== null ? { generationId } : {}),
        sentAt: existing?.sentAt ?? sentAt,
      },
      create: {
        platform,
        platformId,
        serverId,
        channelId,
        channelMessageNo,
        authorId,
        content,
        attachmentsJson,
        generationId,
        editedAt,
        sentAt,
        isBot,
      },
    });
  }

  async findByPlatformIdsInTransaction(
    tx,
    platform,
    platformIds,
    channelId = null,
  ) {
    if (!platformIds.length) return [];

    return await tx.message.findMany({
      where: {
        platform,
        platformId: { in: platformIds },
        ...(channelId ? { channelId } : {}),
      },
      include: { author: { include: { user: true } } },
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
    const where = { platform_platformId: { platform, platformId } };
    const existing = await tx.message.findUnique({ where });
    if (existing) {
      if (existing.channelId !== channelId)
        throw new Error("Deletion does not belong to the event channel.");
      return existing;
    }
    const channelMessageNo = await this.allocateNumber(tx, channelId);
    return await tx.message.upsert({
      where,
      update: {},
      create: {
        platform,
        platformId,
        channelId,
        channelMessageNo,
        content: "",
        deletedAt: new Date(),
      },
    });
  }

  async allocateNumber(tx, channelId) {
    const channel = await tx.channel.update({
      where: { id: channelId },
      data: { lastMessageNo: { increment: 1 } },
      select: { lastMessageNo: true },
    });
    return channel.lastMessageNo;
  }

  async findByChannelMessageNo(channelId, channelMessageNo) {
    return await prisma.message.findUnique({
      where: { channelId_channelMessageNo: { channelId, channelMessageNo } },
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
    before = undefined,
  ) {
    const boundary = before
      ? await prisma.message.findFirst({
          where: {
            platform,
            platformId: before,
            channel: { platformId: platformChannelId },
          },
        })
      : null;
    if (before && !boundary)
      throw new Error(
        "History boundary does not belong to the requested channel.",
      );
    const messages = await prisma.message.findMany({
      where: {
        deletedAt: null,
        ...(boundary ? { id: { lt: boundary.id } } : {}),
        channel: {
          platform,
          platformId: platformChannelId,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
      include: { author: { include: { user: true } } },
    });
  }

  async findByGenerationId(generationId, { includeDeleted = false } = {}) {
    return await prisma.message.findMany({
      where: { generationId, ...(includeDeleted ? {} : { deletedAt: null }) },
      orderBy: { createdAt: "asc" },
    });
  }

  async findGenerationInputsByIds(generationIds) {
    if (!generationIds.length) return new Map();

    const generations = await prisma.generation.findMany({
      where: {
        id: { in: generationIds },
        characterId: getRequiredCharacterId(this.configManager),
      },
      select: { id: true, input: true },
    });

    return new Map(
      generations.map((generation) => [generation.id, generation.input]),
    );
  }
}
