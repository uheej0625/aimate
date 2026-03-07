/**
 * CronService
 *
 * 예약된 cron job을 관리하고 실시간으로 실행한다.
 * - 주기적으로 pending job을 확인 (폴링)
 * - 실행 시각이 된 job을 찾아서 실행
 * - AI에게 전달할 메시지를 채널에 주입
 */
import { adaptChannel } from "../platforms/discord/adapter.js";

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
      console.log("[CronService] Already running");
      return;
    }

    console.log(
      `[CronService] Starting with ${this.pollInterval}ms poll interval`,
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

    console.log("[CronService] Stopping");
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

      console.log(`[CronService] Found ${pendingJobs.length} pending job(s)`);

      for (const job of pendingJobs) {
        try {
          await this.executeJob(job);
        } catch (error) {
          console.error(
            `[CronService] Failed to execute job ${job.id}:`,
            error,
          );
          // 실패해도 다른 job은 계속 실행
        }
      }
    } catch (error) {
      console.error("[CronService] Error checking jobs:", error);
    }
  }

  /**
   * 단일 cron job을 실행한다.
   * @param {Object} job
   */
  async executeJob(job) {
    console.log(`[CronService] Executing job ${job.id} (type: ${job.type})`);

    try {
      // 1. 플랫폼별 채널 객체 가져오기
      const platform = job.platform;
      const client = this.platformClients.get(platform);

      if (!client) {
        console.error(
          `[CronService] No client found for platform: ${platform}`,
        );
        await this.cronJobRepository.updateStatus(job.id, "CANCELLED");
        return;
      }

      // 2. 채널 객체 가져오기
      let channel;
      if (platform === "discord") {
        const rawChannel = await client.channels.fetch(job.channel.platformId);
        channel = adaptChannel(rawChannel);
      } else if (platform === "cli") {
        // CLI는 특별 처리 (임시로 job.channel을 그대로 사용)
        channel = job.channel;
      } else {
        console.error(`[CronService] Unsupported platform: ${platform}`);
        await this.cronJobRepository.updateStatus(job.id, "CANCELLED");
        return;
      }

      if (!channel) {
        console.error(
          `[CronService] Channel not found: ${job.channel.platformId}`,
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

      console.log(`[CronService] Job ${job.id} executed successfully`);
    } catch (error) {
      console.error(`[CronService] Error executing job ${job.id}:`, error);
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
    console.log(
      `[CronService] Registered new job ${job.id} scheduled for ${job.scheduledAt.toLocaleString("ko-KR")}`,
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
