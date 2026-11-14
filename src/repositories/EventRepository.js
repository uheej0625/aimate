import { prisma } from "../database/client.js";
import { getRequiredCharacterId } from "../character/config.js";

/**
 * Repository for immutable conversation event records.
 */
export class EventRepository {
  constructor(configManager) {
    this.characterId = getRequiredCharacterId(configManager);
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

  async findObservation(tx, identity) {
    return await tx.event.findUnique({
      where: {
        characterId_platform_platformMessageId_observationKey: identity,
      },
    });
  }

  /** Bounded observations for decisions; never advances the generation cursor. */
  async decisionContext(channelId, botId, limit, replyIds = []) {
    const where = {
      characterId: this.characterId,
      channelId,
      OR: [
        { generationId: null },
        { generation: { discardedAt: null } },
        { generation: { characterId: { not: this.characterId } } },
      ],
    };
    const include = {
      message: { include: { author: { include: { user: true } } } },
    };
    return prisma.$transaction(async (tx) => {
      const recent = await tx.event.findMany({
        where,
        include,
        orderBy: { id: "desc" },
        take: limit,
      });
      const lastSent = await tx.event.findFirst({
        where: {
          ...where,
          kind: "SENT",
          message: { author: { platformId: botId } },
        },
        include,
        orderBy: { id: "desc" },
      });
      const references = [];
      for (const platformMessageId of replyIds) {
        const event = await tx.event.findFirst({
          where: { ...where, platformMessageId },
          include,
          orderBy: { id: "desc" },
        });
        if (event) references.push(event);
      }
      const events = [
        ...new Map(
          [...recent, ...references, ...(lastSent ? [lastSent] : [])].map(
            (event) => [event.id, event],
          ),
        ).values(),
      ].sort((a, b) => a.id - b.id);
      return {
        events: events.map(toSnapshot),
        lastSentId: lastSent?.id ?? null,
      };
    });
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
        OR: [
          { generationId: null },
          { generation: { discardedAt: null } },
          { generation: { characterId: { not: characterId } } },
        ],
      };
      const include = {
        message: { include: { author: { include: { user: true } } } },
      };
      const history = await tx.event.findMany({
        where: {
          characterId,
          channelId,
          id: { lte: fromExclusive },
          ...visible,
        },
        orderBy: { id: "desc" },
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
            characterId,
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

function toSnapshot({ message, ...event }) {
  return {
    ...event,
    channelMessageNo: message?.channelMessageNo ?? null,
    sentAt: message?.sentAt ?? null,
    authorId: message?.authorId ?? null,
    authorPlatformId: message?.author?.platformId ?? null,
    authorHandle: message?.author?.handle ?? null,
    authorDisplayName: message?.author?.displayName ?? null,
    isBot: message?.isBot ?? false,
    authorCharacterId: message?.author?.user?.characterId ?? null,
  };
}
