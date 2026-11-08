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
    this.characterId = messageService.characterId;
    this.generationRepository = generationLifecycle.generationRepository;
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

    if (
      !message?.generationId ||
      !message.generation.input ||
      message.generation.characterId !== this.characterId
    ) {
      return { status: "NOT_REROLLABLE" };
    }

    const generationMessages = await this.messageRepository.findByGenerationId(
      message.generationId,
    );
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
    const generation = await this.generationRepository.findById(generationId);
    const channel = await this.messageService.channelRepository.findById(
      conversationRequest.internalChannelId,
    );
    const outputs = await this.messageRepository.findByGenerationId(
      generationId,
      { includeDeleted: true },
    );
    if (
      !generation ||
      generation.channelId !== conversationRequest.internalChannelId ||
      channel?.platform !== platform ||
      conversationRequest.channelPort.platform !== platform ||
      channel.platformId !==
        conversationRequest.channelPort.platformChannelId ||
      outputs.some((row) => row.platform !== platform) ||
      platformMessageIds.some(
        (id) => !outputs.some((row) => row.platformId === id),
      )
    )
      throw new Error("Reroll ownership or channel mismatch.");
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
