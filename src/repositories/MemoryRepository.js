import { prisma } from "../database/client.js";

/**
 * Repository for long-term user memory records.
 */
export class MemoryRepository {
  /**
   * @param {string} userId
   * @param {{ limit?: number }} [options]
   * @returns {Promise<Array>}
   */
  async findByUserId(userId, { limit = 20 } = {}) {
    return await prisma.memory.findMany({
      where: { userId },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
  }

  /**
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async create({
    userId,
    platformAccountId = null,
    content,
    category = "fact",
    importance = 1,
    messageId = null,
  }) {
    return await prisma.memory.create({
      data: {
        userId,
        platformAccountId,
        content,
        category,
        importance,
        messageId,
      },
    });
  }

  /**
   * @param {string} userId
   * @param {string} content
   * @returns {Promise<boolean>}
   */
  async existsByContent(userId, content) {
    const count = await prisma.memory.count({
      where: { userId, content },
    });
    return count > 0;
  }
}
