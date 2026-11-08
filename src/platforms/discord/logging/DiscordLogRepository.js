import { prisma } from "../../../database/client.js";

export class DiscordLogRepository {
  constructor(characterId, database = prisma) {
    if (!characterId) throw new Error("Logs require characterId.");
    this.characterId = characterId;
    this.database = database;
  }

  async configure({ guildId, channelId, enabled }) {
    if (!enabled)
      return this.database.logSubscription.deleteMany({
        where: {
          characterId: this.characterId,
          channel: {
            platform: "discord",
            platformId: channelId,
            server: { platformId: guildId },
          },
        },
      });
    const server = {
      connectOrCreate: {
        where: {
          platform_platformId: { platform: "discord", platformId: guildId },
        },
        create: { platform: "discord", platformId: guildId },
      },
    };
    const channel = await this.database.channel.upsert({
      where: {
        platform_platformId: { platform: "discord", platformId: channelId },
      },
      update: { server },
      create: { platform: "discord", platformId: channelId, server },
    });
    return this.database.logSubscription.upsert({
      where: {
        characterId_channelId: {
          characterId: this.characterId,
          channelId: channel.id,
        },
      },
      create: { characterId: this.characterId, channelId: channel.id },
      update: {},
    });
  }

  async destinations() {
    const subscriptions = await this.database.logSubscription.findMany({
      where: {
        characterId: this.characterId,
        channel: { platform: "discord", server: { platform: "discord" } },
      },
      include: { channel: { include: { server: true } } },
    });
    return subscriptions.map(({ channel }) => ({
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
        characterId: this.characterId,
        channel: { platform: "discord", server: { platformId: guildId } },
      },
    });
  }

  async pendingEvents(channelId) {
    const characterId = this.characterId;
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
        message: {
          OR: [
            { isBot: false },
            { author: { user: { characterId: { not: null } } } },
          ],
        },
      },
      select: {
        id: true,
        kind: true,
        snapshotContent: true,
        previousContent: true,
        observedAt: true,
        message: {
          select: {
            channelMessageNo: true,
            author: { select: { user: { select: { characterId: true } } } },
          },
        },
      },
      orderBy: [{ observedAt: "asc" }, { id: "asc" }],
    });
    return events
      .filter(({ message }) => message.author?.user.characterId !== characterId)
      .map(({ message, ...event }) => ({
        ...event,
        channelMessageNo: message.channelMessageNo,
      }));
  }

  async changes({ since, guildIds }) {
    return await this.database.generation.findMany({
      where: {
        characterId: this.characterId,
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
