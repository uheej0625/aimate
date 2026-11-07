import { prisma } from "../database/client.js";
import { ConfigurationError } from "../config/ConfigurationError.js";

/**
 * Repository for PlatformAccount database operations.
 * Handles platform-specific user accounts (Discord, etc.)
 */
export class PlatformAccountRepository {
  /** Claim only unregistered accounts; existing external identities are never merged. */
  async initCharacterAccount({
    characterId,
    platform,
    platformId,
    handle,
    displayName,
  }) {
    return await prisma.$transaction(async (tx) => {
      const where = { platform_platformId: { platform, platformId } };
      const existing = await tx.platformAccount.findUnique({
        where,
        include: { user: true },
      });
      if (existing && existing.user.characterId !== characterId) {
        throw new ConfigurationError(
          `Account ownership conflict: ${platform}/${platformId} cannot belong to character ${characterId}.`,
        );
      }
      const user = await tx.user.upsert({
        where: { characterId },
        create: { characterId },
        update: {},
      });
      const connected = await tx.platformAccount.findFirst({
        where: { userId: user.id, platform },
      });
      if (connected && connected.platformId !== platformId) {
        throw new ConfigurationError(
          `Character ${characterId} supports one account per platform: ${platform}.`,
        );
      }
      const account = await tx.platformAccount.upsert({
        where,
        create: { platform, platformId, userId: user.id, handle, displayName },
        update: { handle, displayName },
      });
      return { account, created: !existing };
    });
  }

  /**
   * Ensure a platform account exists (create or update).
   * @param {Object} accountData - Platform account data
   * @param {string} accountData.platform - Platform name (e.g., "discord")
   * @param {string} accountData.platformId - Platform-specific user ID
   * @param {string} accountData.userId - Internal user ID
   * @param {string} accountData.handle - Username/handle
   * @param {string} [accountData.displayName] - Display name
   * @returns {Promise<Object>} The platform account record
   */
  async upsert(accountData) {
    const { platform, platformId, userId, handle, displayName } = accountData;

    return await prisma.platformAccount.upsert({
      where: {
        platform_platformId: {
          platform,
          platformId,
        },
      },
      update: {
        handle,
        displayName,
      },
      create: {
        platform,
        platformId,
        userId,
        handle,
        displayName,
      },
    });
  }

  /**
   * Find a platform account by platform and platform ID.
   * @param {string} platform - Platform name
   * @param {string} platformId - Platform-specific user ID
   * @returns {Promise<Object|null>}
   */
  async findByPlatformId(platform, platformId) {
    return await prisma.platformAccount.findUnique({
      where: {
        platform_platformId: {
          platform,
          platformId,
        },
      },
      include: {
        user: true,
      },
    });
  }

  /**
   * Find a platform account by internal ID.
   * @param {string} id - Platform account ID
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    return await prisma.platformAccount.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });
  }

  /**
   * Get all platform accounts for a user.
   * @param {string} userId - Internal user ID
   * @returns {Promise<Array>}
   */
  async findByUserId(userId) {
    return await prisma.platformAccount.findMany({
      where: { userId },
    });
  }
}
