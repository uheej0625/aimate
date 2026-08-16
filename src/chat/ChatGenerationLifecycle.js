/**
 * Owns chat generation state transitions and persistence details.
 */
export class ChatGenerationLifecycle {
  constructor(
    generationRepository,
    channelRepository,
    configManager,
  ) {
    this.generationRepository = generationRepository;
    this.channelRepository = channelRepository;
    this.configManager = configManager;
  }

  async findOrCreateChannel(channel) {
    const platform = channel.platform;
    const platformChannelId = channel.platformChannelId;

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
      prompt: getRequiredChatPromptName(this.configManager),
      status: "PROCESSING",
    });
  }

  async recordInput(generationId, { inputMessages, messageIds }) {
    return await this.generationRepository.recordInputWithMessages(
      generationId,
      {
        inputMessages,
        messageIds,
      },
    );
  }

  async canGenerate(generationId) {
    const generation = await this.generationRepository.findById(generationId);
    return generation?.status === "PROCESSING";
  }

  async recordGeneratedOutput(generationId, aiResult) {
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

    const updated =
      await this.generationRepository.updateDetailsAndStatusIfCurrent(
        generationId,
        "PROCESSING",
        "GENERATED",
        {
          output: JSON.stringify(aiResult.messages),
          apiRequest,
          apiResponse,
        },
      );

    return { shouldProceed: updated };
  }

  async complete(generationId) {
    return await this.generationRepository.updateStatusIfCurrent(
      generationId,
      "GENERATED",
      "COMPLETED",
    );
  }

  async cancel(generationId) {
    if (!generationId) return false;
    return await this.generationRepository.updateStatusIfCurrent(
      generationId,
      ["PROCESSING", "GENERATED"],
      "CANCELLED",
    );
  }

  async fail(generationId) {
    if (!generationId) return false;
    return await this.generationRepository.updateStatusIfCurrent(
      generationId,
      ["PROCESSING", "GENERATED"],
      "FAILED",
    );
  }
}
import { getRequiredChatPromptName } from "./promptConfig.js";
