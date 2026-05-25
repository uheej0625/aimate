import { AppEvents } from "./EventBus.js";
import { createLogger } from "./logger.js";

const logger = createLogger("GenerationFailureHandler");

const FALLBACK_ERROR_MESSAGE =
  "죄송합니다. 답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";

/**
 * Applies user-facing and event side effects when a chat generation fails.
 */
export class GenerationFailureHandler {
  constructor(generationLifecycle, messageSender, eventBus) {
    this.generationLifecycle = generationLifecycle;
    this.messageSender = messageSender;
    this.eventBus = eventBus;
  }

  async handle({ error, generation, channelRecord, channel }) {
    try {
      await this.generationLifecycle.fail(generation?.id);
    } catch (dbError) {
      logger.error({ err: dbError }, "Failed to update generation status");
    }

    const platform = channel.platform;
    await this.eventBus.emitAsync(AppEvents.GenerationFailed, {
      error,
      generation,
      channelRecord,
      platform,
    });

    if (this.isServiceUnavailable(error)) {
      logger.warn("503/429 Service Unavailable/Overloaded error detected");
      await this.eventBus.emitAsync(AppEvents.GenerationServiceUnavailable, {
        error,
        generation,
        channelRecord,
        platform,
      });
      return;
    }

    try {
      await this.messageSender.sendChunk(
        channel,
        FALLBACK_ERROR_MESSAGE,
        generation?.id,
      );
    } catch (sendError) {
      logger.error({ err: sendError }, "Failed to send error message");
    }
  }

  isServiceUnavailable(error) {
    return (
      error.status === 503 ||
      error.status === 429 ||
      (error.message &&
        (error.message.includes('"code": 503') ||
          error.message.includes('"code": 429')))
    );
  }
}
