/**
 * Instagram 'connected' 이벤트 핸들러
 * MQTT 연결 성공 시 실행된다.
 */
export default {
  name: "connected",
  once: true,
  /**
   * @param {Object} _data - 이벤트 데이터 (없음)
   * @param {Object} context - { realtime, userId, services, username }
   */
  async execute(_data, context) {
    const { userId, services, username } = context;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`✅ Instagram connected as @${username}`);
    console.log(`📱 User ID: ${userId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

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
      console.error(
        "[Instagram] Failed to initialize bot platform account:",
        error,
      );
    }
  },
};
