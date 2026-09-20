import { prisma } from "../database/client.js";
import { getRequiredCharacterId } from "../character/config.js";

/**
 * Repository for immutable conversation event records.
 */
export class EventRepository {
  constructor(configManager) {
    this.characterId = getRequiredCharacterId(configManager);
    this.historyLimit = configManager.get("conversation.maxContextMessages");
  }

  async findLatestForMessage(tx, { characterId, platform, platformMessageId }) {
    return await tx.event.findFirst({
      where: { characterId, platform, platformMessageId },
      orderBy: { id: "desc" },
    });
  }

  async create(tx, eventData) {
    return await tx.event.create({ data: eventData });
  }

  /** Freeze the observed history and pending range in one database transaction. */
  async snapshot(channelId, rerollGenerationId = null) {
    const characterId = this.characterId;
    return await prisma.$transaction(async (tx) => {
      const state = await tx.conversationState.findUnique({
        where: { characterId_channelId: { characterId, channelId } },
      });
      const fromExclusive = state?.handledThroughEventId ?? 0;
      const visible = {
        OR: [{ generationId: null }, { generation: { discardedAt: null } }],
      };
      const currentMessages = await tx.message.findMany({
        where: {
          channelId,
          deletedAt: null,
          OR: [
            { isBot: false },
            { generationId: null },
            { generation: { discardedAt: null } },
          ],
        },
        orderBy: { id: "desc" },
        take: this.historyLimit,
      });
      // Reading current history is an experience, not a retroactive edit observation.
      for (const message of currentMessages.reverse()) {
        const latest = await this.findLatestForMessage(tx, {
          characterId,
          platform: message.platform,
          platformMessageId: message.platformId,
        });
        if (
          latest &&
          latest.snapshotContent === message.content &&
          latest.snapshotAttachmentsJson === message.attachmentsJson &&
          sameDate(latest.editedAt, message.editedAt)
        )
          continue;
        await this.create(tx, {
          characterId,
          channelId,
          messageId: message.id,
          platform: message.platform,
          platformMessageId: message.platformId,
          kind: "READ",
          source: "HISTORY",
          snapshotContent: message.content,
          snapshotAttachmentsJson: message.attachmentsJson,
          editedAt: message.editedAt,
          generationId: message.isBot ? message.generationId : null,
        });
      }
      const include = { message: { include: { author: true } } };
      const history = await tx.event.findMany({
        where: {
          characterId,
          channelId,
          id: { lte: fromExclusive },
          ...visible,
        },
        orderBy: { id: "desc" },
        take: this.historyLimit,
        include,
      });
      const pending = await tx.event.findMany({
        where: {
          characterId,
          channelId,
          id: { gt: fromExclusive },
          ...visible,
        },
        orderBy: { id: "asc" },
        include,
      });
      const events = [...history.reverse(), ...pending].map(toSnapshot);
      let replay = null;
      if (rerollGenerationId) {
        const original = await tx.generation.findFirst({
          where: {
            id: rerollGenerationId,
            characterId,
            channelId,
            type: "CHAT",
          },
        });
        if (!original?.input)
          throw new Error("The original generation input is unavailable.");
        replay = JSON.parse(original.input).eventSnapshot;
        if (!replay)
          throw new Error("The original generation has no event snapshot.");
        const discarded = await tx.generation.findMany({
          where: {
            id: {
              in: replay.events
                .map((event) => event.generationId)
                .filter((id) => id !== null),
            },
            discardedAt: { not: null },
          },
          select: { id: true },
        });
        const discardedIds = new Set(
          discarded.map((generation) => generation.id),
        );
        replay.events = replay.events.filter(
          (event) => !discardedIds.has(event.generationId),
        );
      }
      return {
        fromExclusive,
        throughInclusive: pending.at(-1)?.id ?? fromExclusive,
        events,
        replay,
        rerollGenerationId,
      };
    });
  }
}

function sameDate(a, b) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function toSnapshot({ message, ...event }) {
  return {
    ...event,
    authorId: message?.authorId ?? null,
    authorPlatformId: message?.author?.platformId ?? null,
    isBot: message?.isBot ?? false,
  };
}
