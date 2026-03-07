import { prisma } from "../database/client.js";
import {
  applyDelta,
  RELATIONSHIP_KEYS,
} from "../engines/relationship/RelationshipEngine.js";

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

  /**
   * PlatformAccount ID로 연결된 User를 조회한다.
   * @param {string} platformAccountId - PlatformAccount.id (내부 ID)
   * @returns {Promise<Object|null>}
   */
  async findByPlatformAccountId(platformAccountId) {
    const account = await prisma.platformAccount.findUnique({
      where: { id: platformAccountId },
      include: { user: true },
    });
    return account?.user ?? null;
  }

  /**
   * 유저의 관계 수치에 delta를 적용하고 저장한다.
   * @param {string} userId - User.id
   * @param {Object} delta  - relationship_delta 객체 ({ affinity?, trust?, affection? })
   * @returns {Promise<Object|null>} 업데이트된 User 레코드
   */
  async applyRelationshipDelta(userId, delta) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const next = applyDelta(user, delta);

    return await prisma.user.update({
      where: { id: userId },
      data: next,
    });
  }
}
