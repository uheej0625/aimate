/**
 * CronService
 *
 * 예약된 cron job을 관리하고 실시간으로 실행한다.
 * - 주기적으로 pending job을 확인 (폴링)
 * - 실행 시각이 된 job을 찾아서 실행
 * - AI에게 전달할 메시지를 채널에 주입
 */
import { adaptChannel as adaptDiscordChannel } from "../platforms/discord/adapter.js";
import { adaptChannel as adaptInstagramChannel } from "../platforms/instagram/adapter.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("CronService");

export class CronService {
  /**
   * @param {import('../repositories/CronJobRepository.js').CronJobRepository} cronJobRepository
   * @param {import('../core/ConversationBuffer.js').ConversationBuffer} conversationBuffer
   * @param {Map<string, any>} platformClients - 플랫폼별 클라이언트 맵
   * @param {Object} [options]
   * @param {number} [options.pollInterval] - 폴링 간격 (ms, 기본값 60000 = 1분)
   */
  constructor(
    cronJobRepository,
    conversationBuffer,
    platformClients = new Map(),
    { pollInterval = 60000 } = {},
  ) {
    this.cronJobRepository = cronJobRepository;
    this.conversationBuffer = conversationBuffer;
    this.platformClients = platformClients;
    this.pollInterval = pollInterval;
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Cron service를 시작한다.
   */
  start() {
    if (this.isRunning) {
      logger.info("Already running");
      return;
    }

    logger.info(
      { pollInterval: this.pollInterval },
      "Starting CronService",
    );
    this.isRunning = true;

    // 즉시 한번 실행
    this.checkAndExecuteJobs();

    // 주기적으로 실행
    this.intervalId = setInterval(() => {
      this.checkAndExecuteJobs();
    }, this.pollInterval);
  }

  /**
   * Cron service를 중지한다.
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info("Stopping CronService");
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Pending job을 확인하고 실행한다.
   */
  async checkAndExecuteJobs() {
    try {
      const pendingJobs = await this.cronJobRepository.getPendingJobs();

      if (pendingJobs.length === 0) {
        return;
      }

      logger.info({ count: pendingJobs.length }, "Found pending jobs");

      for (const job of pendingJobs) {
        try {
          await this.executeJob(job);
        } catch (error) {
          logger.error(
            { err: error, jobId: job.id },
            "Failed to execute job",
          );
          // 실패해도 다른 job은 계속 실행
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error checking jobs");
    }
  }

  /**
   * 단일 cron job을 실행한다.
   * @param {Object} job
   */
  async executeJob(job) {
    logger.info({ jobId: job.id, type: job.type }, "Executing job");

    try {
      // 1. 플랫폼별 채널 객체 가져오기
      const platform = job.platform;
      const client = this.platformClients.get(platform);

      if (!client) {
        logger.error(
          { platform },
          "No client found for platform",
        );
        await this.cronJobRepository.updateStatus(job.id, "CANCELLED");
        return;
      }

      // 2. 채널 객체 가져오기
      let channel;
      if (platform === "discord") {
        const rawChannel = await client.channels.fetch(job.channel.platformId);
        channel = adaptDiscordChannel(rawChannel);
      } else if (platform === "instagram") {
        channel = adaptInstagramChannel(
          job.channel.platformId,
          client.realtime,
          client.user.id,
        );
      } else if (platform === "cli") {
        // CLI는 특별 처리 (임시로 job.channel을 그대로 사용)
        channel = job.channel;
      } else {
        logger.error({ platform }, "Unsupported platform");
        await this.cronJobRepository.updateStatus(job.id, "CANCELLED");
        return;
      }

      if (!channel) {
        logger.error(
          { platformId: job.channel.platformId },
          "Channel not found",
        );
        await this.cronJobRepository.updateStatus(job.id, "CANCELLED");
        return;
      }

      // 3. ConversationBuffer에 job 추가 (시스템 메시지로 처리)
      // AI에게 전달할 메시지를 컨텍스트에 주입
      const botId = client.user?.id ?? "bot";

      // 메시지를 트리거하는 방식: ConversationBuffer를 직접 트리거
      this.conversationBuffer.add(
        job.channel.platformId,
        channel,
        botId,
        job.message, // cronMessage로 전달
      );

      // 4. Job을 EXECUTED로 표시
      await this.cronJobRepository.updateStatus(job.id, "EXECUTED");

      logger.info({ jobId: job.id }, "Job executed successfully");
    } catch (error) {
      logger.error({ err: error, jobId: job.id }, "Error executing job");
      // 실패한 job도 EXECUTED로 표시 (재시도하지 않음)
      await this.cronJobRepository.updateStatus(job.id, "EXECUTED");
    }
  }

  /**
   * 새로운 cron job을 등록한다 (AI tool 또는 내부 로직에서 호출).
   * @param {Object} data
   * @param {string} data.channelId - 내부 채널 ID
   * @param {string} data.platform - 플랫폼
   * @param {Date} data.scheduledAt - 실행 예정 시각
   * @param {string} data.type - "ai_scheduled" | "llm_retry"
   * @param {string} data.message - AI에게 전달할 메시지
   * @param {string} [data.originalContext] - 원본 컨텍스트 (선택)
   * @param {number} [data.retryCount] - 재시도 횟수 (기본값 0)
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
   * 503 에러 발생 시 재시도 cron job을 등록한다.
   * @param {string} channelId - 내부 채널 ID
   * @param {string} platform - 플랫폼
   * @param {number} retryCount - 현재까지 재시도 횟수
   * @returns {Promise<Object>}
   */
  async registerRetryJob(channelId, platform, retryCount = 0) {
    // 1시간 후 + 랜덤 0~15분
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
