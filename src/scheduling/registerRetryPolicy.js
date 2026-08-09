import { AppEvents } from "../core/EventBus.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("RetryPolicy");

export function registerRetryPolicy({ eventBus, cronJobScheduler }) {
  eventBus.on(
    AppEvents.GenerationServiceUnavailable,
    async ({ channelRecord, platform }) => {
      if (!channelRecord) return;

      await cronJobScheduler.registerRetryJob(channelRecord.id, platform, 0);
      logger.info({ channelId: channelRecord.id }, "Retry cron job scheduled");
    },
  );
}
