/**
 * Provides message deletion operations to platform entrypoints.
 */
export class StoredMessageService {
  constructor(messageService) {
    this.messageService = messageService;
  }

  async deleteOne({ platform, platformMessageId }) {
    return await this.messageService.deleteMessage(
      platform,
      platformMessageId,
    );
  }

  async deleteMany({ platform, platformMessageIds }) {
    const { deletedCount } = await this.messageService.deleteMessages(
      platform,
      platformMessageIds,
    );
    return deletedCount;
  }
}
