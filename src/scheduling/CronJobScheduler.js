import { createLogger } from "../core/logger.js";

const logger = createLogger("CronJobScheduler");

/**
 * Registers scheduled jobs without owning their execution lifecycle.
 */
export class CronJobScheduler {
  /**
   * @param {import('../repositories/CronJobRepository.js').CronJobRepository} cronJobRepository
   */
  constructor(cronJobRepository) {
    this.cronJobRepository = cronJobRepository;
  }

  /**
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async registerJob(data) {
    const job = await this.cronJobRepository.create(data);
    logger.info(
      { jobId: job.id, scheduledAt: job.scheduledAt.toLocaleString("ko-KR") },
      "Registered new job",
    );
    return job;
  }

  /**
   * Register an LLM retry one hour plus up to fifteen minutes from now.
   * @param {string} channelId
   * @param {string} platform
   * @param {number} retryCount
   * @returns {Promise<Object>}
   */
  async registerRetryJob(channelId, platform, retryCount = 0) {
    const delayMs = 60 * 60 * 1000 + Math.floor(Math.random() * 15 * 60 * 1000);
    const scheduledAt = new Date(Date.now() + delayMs);
    const delayMinutes = Math.floor(delayMs / 60 / 1000);

    const message =
      `[시스템 알림] ${delayMinutes}분 전에 LLM의 과부하(503 error)로 인해 즉시 응답하지 못했습니다. ` +
      `현재 시각은 ${new Date().toLocaleString("ko-KR")}입니다. ` +
      `사용자의 이전 메시지에 이어서 자연스럽게 응답해주세요.`;

    return await this.registerJob({
      channelId,
      platform,
      scheduledAt,
      type: "llm_retry",
      message,
      retryCount: retryCount + 1,
    });
  }
}
