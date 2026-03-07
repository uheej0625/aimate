import { prisma } from "../database/client.js";

/**
 * Repository for Channel database operations.
 * Handles platform-specific channels.
 */
export class ChannelRepository {
  /**
   * Ensure a channel exists (create or update).
   * @param {Object} channelData - Channel data
   * @param {string} channelData.platform - Platform name (e.g., "discord")
   * @param {string} channelData.platformId - Platform-specific channel ID
   * @param {string} [channelData.serverId] - Server/guild ID (optional)
   * @returns {Promise<Object>} The channel record
   */
  async upsert(channelData) {
    const { platform, platformId, serverId, scope } = channelData;

    return await prisma.channel.upsert({
      where: {
        platform_platformId: {
          platform,
          platformId,
        },
      },
      update: {
        serverId: serverId || undefined,
        scope: scope ?? undefined,
      },
      create: {
        platform,
        platformId,
        serverId,
        scope: scope ?? null,
      },
    });
  }

  /**
   * Find a channel by platform and platform ID.
   * @param {string} platform - Platform name
   * @param {string} platformId - Platform-specific channel ID
   * @returns {Promise<Object|null>}
   */
  async findByPlatformId(platform, platformId) {
    return await prisma.channel.findUnique({
      where: {
        platform_platformId: {
          platform,
          platformId,
        },
      },
      include: {
        server: true,
      },
    });
  }

  /**
   * Find a channel by internal ID.
   * @param {string} id - Channel ID
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    return await prisma.channel.findUnique({
      where: { id },
      include: {
        server: true,
      },
    });
  }
}
