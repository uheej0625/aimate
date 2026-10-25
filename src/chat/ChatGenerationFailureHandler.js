import { AppEvents } from "../core/EventBus.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("ChatGenerationFailureHandler");

const FALLBACK_ERROR_MESSAGE =
  "죄송합니다. 답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";

/**
 * Applies user-facing and event side effects when a chat generation fails.
 */
export class ChatGenerationFailureHandler {
  constructor(generationLifecycle, messageSender, eventBus) {
    this.generationLifecycle = generationLifecycle;
    this.messageSender = messageSender;
    this.eventBus = eventBus;
  }

  async handle({ error, generation, channelRecord, channel, delivery = {} }) {
    try {
      await this.generationLifecycle.fail(generation?.id);
    } catch (dbError) {
      logger.error(
        {
          event: "generation.failure_status.failed",
          generationId: generation?.id,
          err: dbError,
        },
        "Failed to update generation status",
      );
    }

    const platform = channel.platform;
    await this.eventBus.emitAsync(AppEvents.GenerationFailed, {
      error,
      generation,
      channelRecord,
      platform,
    });

    try {
      const sent = await this.messageSender.send(
        channel,
        FALLBACK_ERROR_MESSAGE,
        generation?.id,
        { ...delivery, allowFailure: true },
      );
      logger[sent === false ? "debug" : "info"](
        {
          event:
            sent === false
              ? "generation.fallback.skipped"
              : "generation.fallback.sent",
          generationId: generation?.id,
        },
        "Generation failure fallback handled",
      );
    } catch (sendError) {
      logger.error(
        {
          event: "generation.fallback.failed",
          generationId: generation?.id,
          err: sendError,
        },
        "Failed to send error message",
      );
    }
  }
}
