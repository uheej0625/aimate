/**
 * Coordinates stored-message cleanup and conversation regeneration.
 */
export class RerollConversation {
  constructor(
    messageRepository,
    messageService,
    chatFlow,
    generationLifecycle,
    conversationSession,
  ) {
    this.messageRepository = messageRepository;
    this.messageService = messageService;
    this.chatFlow = chatFlow;
    this.generationLifecycle = generationLifecycle;
    this.conversationSession = conversationSession;
  }

  async prepare({ platform, platformMessageId }) {
    const message = await this.messageRepository.findByPlatformId(
      platform,
      platformMessageId,
    );

    if (!message?.isBot || !message.generationId || !message.generation.input) {
      return { status: "NOT_REROLLABLE" };
    }

    const generationMessages = (
      await this.messageRepository.findByGenerationId(message.generationId)
    ).filter((row) => row.isBot);
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

  async execute({
    platform,
    platformMessageIds,
    conversationRequest,
    generationId,
  }) {
    const session = this.conversationSession;
    const key = session.key(conversationRequest.channelPort);
    const { deletedCount } = await session.run(key, async () => {
      await this.generationLifecycle.discard(generationId);
      return await this.messageService.deleteMessages(
        platform,
        platformMessageIds,
        conversationRequest.internalChannelId,
        { observed: session.isWatching(key) },
      );
    });
    await this.chatFlow.execute({
      ...conversationRequest,
      rerollGenerationId: generationId,
    });
    return { deletedCount };
  }
}
