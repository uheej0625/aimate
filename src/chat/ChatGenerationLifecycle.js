/**
 * Owns chat generation state transitions and persistence details.
 */
export class ChatGenerationLifecycle {
  constructor(
    generationRepository,
    channelRepository,
    messageRepository,
    configManager,
  ) {
    this.generationRepository = generationRepository;
    this.channelRepository = channelRepository;
    this.messageRepository = messageRepository;
    this.configManager = configManager;
  }

  async findOrCreateChannel(channel) {
    const platform = channel.platform;
    const platformChannelId = channel.id;

    let channelRecord = await this.channelRepository.findByPlatformId(
      platform,
      platformChannelId,
    );

    if (!channelRecord) {
      channelRecord = await this.channelRepository.upsert({
        platform,
        platformId: platformChannelId,
        serverId: null,
      });
    }

    return channelRecord;
  }

  async startChatGeneration(channelRecord) {
    return await this.generationRepository.create({
      channelId: channelRecord.id,
      type: "CHAT",
      prompt: this.configManager.get("ai.chat.prompt") || "default",
      status: "PROCESSING",
    });
  }

  async recordInput(generationId, { inputMessages, messageIds }) {
    await this.generationRepository.updateDetails(generationId, {
      input: JSON.stringify({
        messages: inputMessages.map((content, index) => ({
          id: messageIds[index] ?? null,
          content,
        })),
      }),
    });

    for (const messageId of messageIds) {
      await this.messageRepository.addGenerationId(messageId, generationId);
    }
  }

  async markReadyToGenerate(generationId) {
    return await this.generationRepository.checkAndUpdateStatus(
      generationId,
      "GENERATED",
    );
  }

  async recordOutput(generationId, aiResult) {
    const apiRequest =
      aiResult.apiRequests?.length === 1
        ? aiResult.apiRequests[0]
        : aiResult.apiRequests?.length > 1
          ? aiResult.apiRequests
          : undefined;
    const apiResponse =
      aiResult.apiResponses?.length === 1
        ? aiResult.apiResponses[0]
        : aiResult.apiResponses?.length > 1
          ? aiResult.apiResponses
          : undefined;

    await this.generationRepository.updateDetails(generationId, {
      output: JSON.stringify(aiResult.messages),
      metadata: {
        emotionDelta: aiResult.emotionDelta,
        emotionReason: aiResult.emotionReason,
        relationshipDelta: aiResult.relationshipDelta,
      },
      apiRequest,
      apiResponse,
    });
  }

  async complete(generationId) {
    await this.generationRepository.updateStatus(generationId, "COMPLETED");
  }

  async fail(generationId) {
    if (!generationId) return;
    await this.generationRepository.updateStatus(generationId, "FAILED");
  }
}
