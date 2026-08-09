import { createLogger } from "../core/logger.js";

const logger = createLogger("CronJobWorker");

/**
 * Polls and executes scheduled jobs.
 */
export class CronJobWorker {
  /**
   * @param {import('../repositories/CronJobRepository.js').CronJobRepository} cronJobRepository
   * @param {import('../chat/ConversationBuffer.js').ConversationBuffer} conversationBuffer
   * @param {Map<string, {resolveChannel: Function, getBotId: Function}>} platformDispatchers
   * @param {Object} [options]
   * @param {number} [options.pollInterval]
   */
  constructor(
    cronJobRepository,
    conversationBuffer,
    platformDispatchers = new Map(),
    { pollInterval = 5000 } = {},
  ) {
    this.cronJobRepository = cronJobRepository;
    this.conversationBuffer = conversationBuffer;
    this.platformDispatchers = platformDispatchers;
    this.pollInterval = pollInterval;
    this.intervalId = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      logger.info("Already running");
      return;
    }

    logger.info({ pollInterval: this.pollInterval }, "Starting CronJobWorker");
    this.isRunning = true;
    this.checkAndExecuteJobs();
    this.intervalId = setInterval(() => {
      this.checkAndExecuteJobs();
    }, this.pollInterval);
  }

  stop() {
    if (!this.isRunning) return;

    logger.info("Stopping CronJobWorker");
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async checkAndExecuteJobs() {
    try {
      const pendingJobs = await this.cronJobRepository.getPendingJobs();
      if (pendingJobs.length === 0) return;

      logger.info({ count: pendingJobs.length }, "Found pending jobs");

      for (const job of pendingJobs) {
        try {
          await this.executeJob(job);
        } catch (error) {
          logger.error({ err: error, jobId: job.id }, "Failed to execute job");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error checking jobs");
    }
  }

  async executeJob(job) {
    logger.info({ jobId: job.id, type: job.type }, "Executing job");

    try {
      const platform = job.platform;
      const dispatcher = this.platformDispatchers.get(platform);

      if (!dispatcher) {
        logger.error({ platform }, "No dispatcher found for platform");
        await this.cronJobRepository.updateStatus(job.id, "CANCELLED");
        return;
      }

      const channel = await dispatcher.resolveChannel(job);

      if (!channel) {
        logger.error(
          { platformId: job.channel.platformId },
          "Channel not found",
        );
        await this.cronJobRepository.updateStatus(job.id, "CANCELLED");
        return;
      }

      const botId = (await dispatcher.getBotId(job)) ?? "bot";
      this.conversationBuffer.add({
        channel,
        botId,
        cronMessage: job.message,
      });

      await this.cronJobRepository.updateStatus(job.id, "EXECUTED");
      logger.info({ jobId: job.id }, "Job executed successfully");
    } catch (error) {
      logger.error({ err: error, jobId: job.id }, "Error executing job");
      await this.cronJobRepository.updateStatus(job.id, "EXECUTED");
    }
  }
}
