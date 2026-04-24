import { ScopeKey } from "../repositories/EmotionStateRepository.js";
import { createLogger } from "./logger.js";

const logger = createLogger("ChatFlow");

/**
 * Core business logic for generating a response in a conversation.
 * Coordinates Context -> AI -> Sender
 */
export class ChatFlow {
  /**
   * @param {import('../repositories/GenerationRepository.js').GenerationRepository} generationRepository
   * @param {import('../repositories/ChannelRepository.js').ChannelRepository} channelRepository
   * @param {import('../services/AIService.js').AIService} aiService
   * @param {import('./MessageSender.js').MessageSender} messageSender
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {import('../repositories/EmotionStateRepository.js').EmotionStateRepository} emotionStateRepository
   * @param {Object} [callbacks]
   * @param {function} [callbacks.onServiceUnavailable] - 503 등 서비스 불가 시 호출되는 콜백
   * @param {import('../repositories/UserRepository.js').UserRepository} [callbacks.userRepository]
   */
  constructor(
    generationRepository,
    channelRepository,
    aiService,
    messageSender,
    configManager,
    emotionStateRepository,
    { onServiceUnavailable, userRepository } = {},
  ) {
    this.generationRepository = generationRepository;
    this.channelRepository = channelRepository;
    this.aiService = aiService;
    this.messageSender = messageSender;
    this.configManager = configManager;
    this.emotionStateRepository = emotionStateRepository;
    this.userRepository = userRepository ?? null;
    this.onServiceUnavailable = onServiceUnavailable ?? (() => {});
  }

  /**
   * Execute the conversation logic.
   * @param {import('discord.js').TextBasedChannel} channel
   * @param {string} botId
   * @param {string} [cronMessage] - Cron job에서 전달되는 시스템 메시지 (선택)
   */
  async execute(channel, botId, cronMessage = null) {
    let generation;
    let channelRecord;

    try {
      // 0. Get or create internal channel
      const platform = channel.platform;
      channelRecord = await this.channelRepository.findByPlatformId(
        platform,
        channel.id,
      );

      if (!channelRecord) {
        // Channel should have been created by MessageHandler, but create if missing
        channelRecord = await this.channelRepository.upsert({
          platform: platform,
          platformId: channel.id,
          serverId: null,
        });
      }

      // 1. Start Generation Tracking
      generation = await this.generationRepository.create({
        channelId: channelRecord.id,
        messagesJson: "[]",
        status: "PROCESSING",
      });

      // 2. Prepare Context
      const { context, systemInstruction, messageIds, currentUserId } =
        await this.aiService.prepareContext(
          channelRecord.id,
          botId,
          channelRecord,
          cronMessage,
        );

      // 3. Save context message IDs
      await this.generationRepository.updateDetails(generation.id, {
        messageIds,
      });

      // 4. Check Cancellation before generating
      const result = await this.generationRepository.checkAndUpdateStatus(
        generation.id,
        "GENERATED",
      );

      if (!result.shouldProceed) {
        logger.info({ generationId: generation.id }, "Generation cancelled");
        return;
      }

      // 5. Generate response (JSON parsed)
      const aiResult = await this.aiService.generateChat(
        context,
        systemInstruction,
        channel.platform,
        channelRecord,
      );

      // 6. Save AI response details (including raw API req/res)
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

      await this.generationRepository.updateDetails(generation.id, {
        responseMessages: aiResult.messages,
        emotionDelta: aiResult.emotionDelta,
        emotionReason: aiResult.emotionReason,
        relationshipDelta: aiResult.relationshipDelta,
        apiRequest,
        apiResponse,
      });

      // 7. Send each message chunk
      for (const message of aiResult.messages) {
        const sent = await this.messageSender.sendChunk(
          channel,
          message,
          generation.id,
        );
        if (!sent) {
          logger.info(
            { generationId: generation.id },
            "Generation cancelled during send",
          );
          return;
        }
      }

      // 8. Mark as COMPLETED after all messages sent
      await this.generationRepository.updateStatus(generation.id, "COMPLETED");

      // 9. Apply emotion delta — channelRecord.scope에 해당하는 스코프 하나만 적용
      if (
        aiResult.emotionDelta &&
        Object.keys(aiResult.emotionDelta).length > 0
      ) {
        const delta = aiResult.emotionDelta;
        const scope = channelRecord.scope ?? "channel";

        if (scope === "global") {
          await this.emotionStateRepository.applyDelta(
            ScopeKey.global(),
            "GLOBAL",
            delta,
          );
        } else if (scope === "server" && channelRecord.serverId) {
          await this.emotionStateRepository.applyDelta(
            ScopeKey.server(channelRecord.serverId),
            "SERVER",
            delta,
            { serverId: channelRecord.serverId },
          );
        } else {
          await this.emotionStateRepository.applyDelta(
            ScopeKey.channel(channelRecord.id),
            "CHANNEL",
            delta,
            { channelId: channelRecord.id },
          );
        }

        logger.info(
          { scope, reason: aiResult.emotionReason },
          "Emotion delta applied",
        );
      }

      // 10. Apply relationship delta — currentUserId 유저에만 적용
      if (
        currentUserId &&
        this.userRepository &&
        aiResult.relationshipDelta &&
        Object.keys(aiResult.relationshipDelta).length > 0
      ) {
        await this.userRepository.applyRelationshipDelta(
          currentUserId,
          aiResult.relationshipDelta,
        );
        logger.info({ userId: currentUserId }, "Relationship delta applied");
      }
    } catch (error) {
      logger.error({ err: error }, "Error processing response");

      // Mark generation as FAILED
      if (generation?.id) {
        try {
          await this.generationRepository.updateStatus(generation.id, "FAILED");
        } catch (dbError) {
          logger.error({ err: dbError }, "Failed to update generation status");
        }
      }

      // Check if it's a 503 (Google Cloud) or 429 (Vertex) error
      const isOverloaded =
        error.status === 503 ||
        error.status === 429 ||
        (error.message &&
          (error.message.includes('"code": 503') ||
            error.message.includes('"code": 429')));

      if (isOverloaded) {
        // 503/429 error: 플랫폼별 콜백으로 처리 위임
        logger.warn("503/429 Service Unavailable/Overloaded error detected");
        try {
          await this.onServiceUnavailable(error, {
            channelRecord,
            platform: channel.platform,
          });
        } catch (callbackError) {
          logger.error(
            { err: callbackError },
            "Failed to handle service unavailable",
          );
        }
        // Don't send error message to user for 503/429 errors
      } else {
        // For other errors, notify user
        try {
          await this.messageSender.sendChunk(
            channel,
            "죄송합니다. 답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
            generation?.id,
          );
        } catch (sendError) {
          logger.error({ err: sendError }, "Failed to send error message");
        }
      }
    }
  }
}
