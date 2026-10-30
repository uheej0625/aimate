import { AppEvents } from "../core/EventBus.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("ChatGenerationFailureHandler");

/** Failures are reported to logs/subscribers, never as character speech. */
export class ChatGenerationFailureHandler {
  constructor(generationLifecycle, eventBus) {
    this.generationLifecycle = generationLifecycle;
    this.eventBus = eventBus;
  }

  async handle({ error, generation, channelRecord, channel }) {
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
    await this.eventBus.emitAsync(AppEvents.GenerationFailed, {
      error,
      generation,
      channelRecord,
      platform: channel.platform,
    });
  }
}
