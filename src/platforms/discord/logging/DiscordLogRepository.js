import { prisma } from "../../../database/client.js";

export class DiscordLogRepository {
  constructor(database = prisma) {
    this.database = database;
  }

  async configure({ guildId, channelId, enabled }) {
    if (!enabled) {
      return await this.database.channel.updateMany({
        where: {
          platform: "discord",
          platformId: channelId,
          server: { platformId: guildId },
          logEnabled: true,
        },
        data: { logEnabled: false },
      });
    }
    const server = {
      connectOrCreate: {
        where: {
          platform_platformId: { platform: "discord", platformId: guildId },
        },
        create: { platform: "discord", platformId: guildId },
      },
    };
    return await this.database.channel.upsert({
      where: {
        platform_platformId: { platform: "discord", platformId: channelId },
      },
      update: { logEnabled: true, server },
      create: {
        platform: "discord",
        platformId: channelId,
        logEnabled: true,
        server,
      },
    });
  }

  async destinations() {
    const channels = await this.database.channel.findMany({
      where: {
        platform: "discord",
        logEnabled: true,
        server: { platform: "discord" },
      },
      select: { platformId: true, server: { select: { platformId: true } } },
    });
    return channels.map((channel) => ({
      guildId: channel.server.platformId,
      channelId: channel.platformId,
    }));
  }

  async sourceChannel(platformId) {
    return await this.database.channel.findUnique({
      where: { platform_platformId: { platform: "discord", platformId } },
      include: { server: true },
    });
  }

  async generation(id, guildId) {
    return await this.database.generation.findFirst({
      where: {
        id,
        channel: { platform: "discord", server: { platformId: guildId } },
      },
    });
  }

  async pendingEvents(channelId, characterId) {
    const state = await this.database.conversationState.findUnique({
      where: { characterId_channelId: { characterId, channelId } },
    });
    const events = await this.database.event.findMany({
      where: {
        characterId,
        channelId,
        id: { gt: state?.handledThroughEventId ?? 0 },
        source: "LIVE",
        kind: { in: ["READ", "EDIT", "DELETE"] },
        message: { isBot: false },
      },
      select: {
        id: true,
        kind: true,
        snapshotContent: true,
        previousContent: true,
        observedAt: true,
        message: { select: { channelMessageNo: true } },
      },
      orderBy: [{ observedAt: "asc" }, { id: "asc" }],
    });
    return events.map(({ message, ...event }) => ({
      ...event,
      channelMessageNo: message.channelMessageNo,
    }));
  }

  async changes({ since, guildIds }) {
    return await this.database.generation.findMany({
      where: {
        channel: {
          platform: "discord",
          server: { platformId: { in: guildIds } },
        },
        updatedAt: { gte: since },
      },
      include: {
        channel: { include: { server: true } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    });
  }
}
