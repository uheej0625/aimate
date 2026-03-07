/** @type {import('../ToolRegistry.js').ToolDef} */
export default {
  name: "register_cron_job",
  enabled: true,
  platforms: ["*"], // 모든 플랫폼에서 사용 가능
  requires: [], // 별도 자격증명 불필요

  declaration: {
    name: "register_cron_job",
    description:
      "특정 시각에 AI가 사전에 설정한 메시지를 다시 받아 응답하도록 예약한다. " +
      "예: 사용자가 1시간 후에 알림을 요청한 경우, 1시간 후에 AI가 메시지를 보내도록 예약할 수 있다.",
    parameters: {
      type: "object",
      properties: {
        scheduledTime: {
          type: "string",
          description:
            "실행 예정 시각. ISO 8601 형식 또는 상대 시간 (예: '1h', '30m', '2h30m')",
        },
        message: {
          type: "string",
          description:
            "예약된 시각에 AI에게 전달할 메시지. " +
            "이 메시지는 AI가 컨텍스트로 받게 되며, 사용자에게 응답할 때 참고한다. " +
            "예: '사용자가 1시간 후에 깨워달라고 요청했습니다. 친근하게 메시지를 보내세요.'",
        },
      },
      required: ["scheduledTime", "message"],
    },
  },

  /**
   * @param {Object} args
   * @param {string} args.scheduledTime - ISO 8601 또는 상대 시간 (예: "1h", "30m")
   * @param {string} args.message - AI에게 전달할 메시지
   * @param {Object} ctx
   * @param {Object} ctx.cronService - CronService 인스턴스
   * @param {Object} ctx.channel - 채널 객체 (내부 Channel 레코드)
   */
  execute: async (args, ctx) => {
    if (!ctx.cronService) {
      return { error: "CronService not available" };
    }

    if (!ctx.channel) {
      return { error: "Channel context not available" };
    }

    try {
      // 시간 파싱
      const scheduledAt = parseScheduledTime(args.scheduledTime);

      // Cron job 등록
      const job = await ctx.cronService.registerJob({
        channelId: ctx.channel.id,
        platform: ctx.channel.platform,
        scheduledAt,
        type: "ai_scheduled",
        message: args.message,
      });

      const formattedTime = scheduledAt.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
      });

      return {
        success: true,
        jobId: job.id,
        scheduledAt: job.scheduledAt.toISOString(),
        scheduledAtLocal: formattedTime,
        message: `Cron job이 성공적으로 등록되었습니다. 실행 예정 시각: ${formattedTime}`,
      };
    } catch (error) {
      console.error("[registerCron] Error:", error);
      return {
        error: error.message,
      };
    }
  },
};

/**
 * 시간 문자열을 Date 객체로 파싱한다.
 * @param {string} timeStr - ISO 8601 또는 상대 시간 (예: "1h", "30m", "2h30m")
 * @returns {Date}
 */
function parseScheduledTime(timeStr) {
  // ISO 8601 형식 시도
  const isoDate = new Date(timeStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // 상대 시간 파싱 (예: "1h", "30m", "2h30m")
  const relativePattern = /^(?:(\d+)h)?(?:(\d+)m)?$/;
  const match = timeStr.trim().match(relativePattern);

  if (!match) {
    throw new Error(
      `Invalid time format: "${timeStr}". Use ISO 8601 or relative time (e.g., "1h", "30m", "2h30m")`,
    );
  }

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);

  if (hours === 0 && minutes === 0) {
    throw new Error("Time must be greater than 0");
  }

  const now = new Date();
  const scheduledAt = new Date(
    now.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000,
  );

  return scheduledAt;
}
