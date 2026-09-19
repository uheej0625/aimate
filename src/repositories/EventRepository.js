/**
 * Repository for immutable conversation event records.
 */
export class EventRepository {
  async findLatestForMessage(tx, { characterId, platform, platformMessageId }) {
    return await tx.event.findFirst({
      where: { characterId, platform, platformMessageId },
      orderBy: { id: "desc" },
    });
  }

  async create(tx, eventData) {
    return await tx.event.create({ data: eventData });
  }
}
