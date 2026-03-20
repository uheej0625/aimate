/**
 * Instagram 'connected' 이벤트 핸들러
 * MQTT 연결 성공 시 실행된다.
 */
import { createLogger } from "../../../core/logger.js";

const logger = createLogger("Instagram:Connected");

export default {
  name: "connected",
  once: true,
  /**
   * @param {Object} _data - 이벤트 데이터 (없음)
   * @param {Object} context - { realtime, userId, services, username }
   */
  async execute(_data, context) {
    const { userId, services, username } = context;

    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.info({ username }, "✅ Instagram connected");
    logger.info({ userId }, "📱 User ID");
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // 봇 플랫폼 계정 초기화
    try {
      const { botAccountService } = services;
      await botAccountService.initBotAccount({
        platform: "instagram",
        platformId: userId,
        handle: username,
        displayName: username,
      });
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to initialize bot platform account",
      );
    }
  },
};
