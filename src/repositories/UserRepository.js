import { prisma } from "../database/client.js";

/**
 * Repository for User database operations.
 * Handles core user records (platform-agnostic).
 */
export class UserRepository {
  /**
   * Create a new user.
   * @returns {Promise<Object>} The created user record
   */
  async create() {
    return await prisma.user.create({
      data: {},
    });
  }

  /**
   * Get a user by ID.
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>}
   */
  async findById(userId) {
    return await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: true,
        memories: true,
      },
    });
  }

  /**
   * Get all users.
   * @returns {Promise<Array>}
   */
  async findAll() {
    return await prisma.user.findMany({
      include: {
        accounts: true,
      },
    });
  }
}
