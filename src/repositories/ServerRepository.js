import { prisma } from "../database/client.js";

/**
 * Repository for Server database operations.
 * Handles platform-specific servers/guilds.
 */
export class ServerRepository {
  /**
   * Ensure a server exists (create or update).
   * @param {Object} serverData - Server data
   * @param {string} serverData.platform - Platform name (e.g., "discord")
   * @param {string} serverData.platformId - Platform-specific server/guild ID
   * @returns {Promise<Object>} The server record
   */
  async upsert(serverData) {
    const { platform, platformId } = serverData;

    return await prisma.server.upsert({
      where: {
        platform_platformId: {
          platform,
          platformId,
        },
      },
      update: {},
      create: {
        platform,
        platformId,
      },
    });
  }

  /**
   * Find a server by platform and platform ID.
   * @param {string} platform - Platform name
   * @param {string} platformId - Platform-specific server/guild ID
   * @returns {Promise<Object|null>}
   */
  async findByPlatformId(platform, platformId) {
    return await prisma.server.findUnique({
      where: {
        platform_platformId: {
          platform,
          platformId,
        },
      },
      include: {
        channels: true,
      },
    });
  }

  /**
   * Find a server by internal ID.
   * @param {string} id - Server ID
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    return await prisma.server.findUnique({
      where: { id },
      include: {
        channels: true,
      },
    });
  }
}
