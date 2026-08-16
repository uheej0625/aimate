/**
 * Provides message deletion operations to platform entrypoints.
 */
export class StoredMessageService {
  constructor(messageRepository) {
    this.messageRepository = messageRepository;
  }

  async deleteOne({ platform, platformMessageId }) {
    return await this.messageRepository.deleteByPlatformId(
      platform,
      platformMessageId,
    );
  }

  async deleteMany({ platform, platformMessageIds }) {
    return await this.messageRepository.deleteManyByPlatformIds(
      platform,
      platformMessageIds,
    );
  }
}
