/**
 * Coordinates stored-message cleanup and conversation regeneration.
 */
export class RerollConversation {
  constructor(messageRepository, chatFlow) {
    this.messageRepository = messageRepository;
    this.chatFlow = chatFlow;
  }

  async prepare({ platform, platformMessageId }) {
    const message = await this.messageRepository.findByPlatformId(
      platform,
      platformMessageId,
    );

    if (!message?.generationId) {
      return { status: "NOT_REROLLABLE" };
    }

    const generationMessages =
      await this.messageRepository.findByGenerationId(message.generationId);
    if (!generationMessages.length) {
      return { status: "MESSAGES_NOT_FOUND" };
    }

    return {
      status: "READY",
      generationId: message.generationId,
      platformMessageIds: generationMessages.map(
        (generationMessage) => generationMessage.platformId,
      ),
    };
  }

  async execute({ platform, platformMessageIds, conversationRequest }) {
    const deletedCount =
      await this.messageRepository.deleteManyByPlatformIds(
        platform,
        platformMessageIds,
      );

    await this.chatFlow.execute(conversationRequest);
    return { deletedCount };
  }
}
