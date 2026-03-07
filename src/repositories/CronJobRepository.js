import { prisma } from "../database/client.js";

/**
 * Repository for managing scheduled cron jobs
 */
export class CronJobRepository {
  /**
   * 새로운 cron job을 생성한다.
   * @param {Object} data
   * @param {string} data.channelId - 내부 채널 ID
   * @param {string} data.platform - 플랫폼 ("discord", "cli" 등)
   * @param {Date} data.scheduledAt - 실행 예정 시각
   * @param {string} data.type - "ai_scheduled" | "llm_retry"
   * @param {string} data.message - AI에게 전달할 메시지
   * @param {string} [data.originalContext] - JSON 문자열 (선택)
   * @param {number} [data.retryCount] - 재시도 횟수 (기본값 0)
   * @returns {Promise<Object>}
   */
  async create(data) {
    return await prisma.cronJob.create({
      data: {
        channelId: data.channelId,
        platform: data.platform,
        scheduledAt: data.scheduledAt,
        type: data.type,
        message: data.message,
        originalContext: data.originalContext ?? null,
        retryCount: data.retryCount ?? 0,
        status: "PENDING",
      },
    });
  }

  /**
   * 실행 대기 중인 cron job 목록을 가져온다.
   * @param {Date} [beforeTime] - 이 시각 이전에 예정된 job만 가져옴 (기본값: 현재 시각)
   * @returns {Promise<Array>}
   */
  async getPendingJobs(beforeTime = null) {
    const cutoff = beforeTime ?? new Date();
    return await prisma.cronJob.findMany({
      where: {
        status: "PENDING",
        scheduledAt: {
          lte: cutoff,
        },
      },
      orderBy: {
        scheduledAt: "asc",
      },
      include: {
        channel: true,
      },
    });
  }

  /**
   * Cron job의 상태를 업데이트한다.
   * @param {number} id
   * @param {string} status - "EXECUTED" | "CANCELLED"
   * @returns {Promise<Object>}
   */
  async updateStatus(id, status) {
    return await prisma.cronJob.update({
      where: { id },
      data: {
        status,
        executedAt: status === "EXECUTED" ? new Date() : undefined,
      },
    });
  }

  /**
   * 특정 채널의 PENDING 상태인 cron job을 모두 취소한다.
   * @param {string} channelId
   * @returns {Promise<Object>}
   */
  async cancelPendingForChannel(channelId) {
    return await prisma.cronJob.updateMany({
      where: {
        channelId,
        status: "PENDING",
      },
      data: {
        status: "CANCELLED",
      },
    });
  }

  /**
   * 특정 타입의 PENDING 상태 cron job을 채널별로 찾는다.
   * @param {string} channelId
   * @param {string} type
   * @returns {Promise<Array>}
   */
  async findPendingByChannelAndType(channelId, type) {
    return await prisma.cronJob.findMany({
      where: {
        channelId,
        type,
        status: "PENDING",
      },
      orderBy: {
        scheduledAt: "asc",
      },
    });
  }

  /**
   * 오래된 실행 완료/취소된 cron job을 정리한다.
   * @param {number} daysOld - 며칠 이전 데이터를 삭제할지
   * @returns {Promise<Object>}
   */
  async cleanupOldJobs(daysOld = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    return await prisma.cronJob.deleteMany({
      where: {
        status: {
          in: ["EXECUTED", "CANCELLED"],
        },
        createdAt: {
          lt: cutoffDate,
        },
      },
    });
  }
}
