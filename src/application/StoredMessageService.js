/** Routes confirmed command deletions through the same observation policy as platform events. */
export class StoredMessageService {
  constructor(messageHandler) {
    this.messageHandler = messageHandler;
  }

  async deleteOne({ platformMessageId, channel, botId }) {
    return (
      (await this.deleteMany({
        platformMessageIds: [platformMessageId],
        channel,
        botId,
      })) > 0
    );
  }

  async deleteMany({ platformMessageIds, channel, botId }) {
    const result = await this.messageHandler.handle({
      kind: "DELETE",
      platformMessageIds,
      channel,
      botId,
    });
    return result.deletedCount ?? 0;
  }
}
