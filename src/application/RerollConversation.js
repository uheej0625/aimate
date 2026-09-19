/**
 * Coordinates stored-message cleanup and conversation regeneration.
 */
export class RerollConversation {
  constructor(messageRepository, messageService, chatFlow) {
    this.messageRepository = messageRepository;
    this.messageService = messageService;
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
      internalChannelId: message.generation.channelId,
      platformMessageIds: generationMessages.map(
        (generationMessage) => generationMessage.platformId,
      ),
    };
  }

  async execute({ platform, platformMessageIds, conversationRequest }) {
    const { deletedCount } = await this.messageService.deleteMessages(
      platform,
      platformMessageIds,
    );

    await this.chatFlow.execute(conversationRequest);
    return { deletedCount };
  }
}
