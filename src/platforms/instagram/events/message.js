/**
 * Instagram 'message' 이벤트 핸들러
 * MQTT를 통해 수신된 DM을 처리한다.
 */
import { adaptMessage } from "../adapter.js";

export default {
  name: "message",
  /**
   * @param {Object} data - realtime 'message' 이벤트 데이터
   * @param {Object} context - { realtime, userId, services }
   */
  async execute(data, context) {
    const { realtime, userId, services, ig } = context;
    const msg = data.message;

    // 텍스트가 없는 메시지(사진, 비디오, 리액션 등)는 무시
    if (!msg?.text) return;

    // Instagram DM은 /enable 명령이 없으므로 채널을 자동 활성화
    await services.channelRepository.upsert({
      platform: "instagram",
      platformId: msg.thread_id,
      serverId: null,
    });

    const senderId = String(
      msg.from_user_id ?? msg.user_id ?? msg.sender_id ?? "unknown",
    );
    let userInfo = null;

    if (senderId !== "unknown" && ig) {
      try {
        // 기존 DB에 handle이 제대로 저장되어 있는지 확인
        const account =
          await services.platformAccountRepository.findByPlatformId(
            "instagram",
            senderId,
          );

        if (account && account.handle && account.handle !== senderId) {
          userInfo = {
            username: account.handle,
            globalName: account.displayName,
          };
        } else {
          // DB에 없거나 handle이 senderId(초기값)와 같으면 IG API로 조회
          const igUser = await ig.user.info(senderId);
          userInfo = {
            username: igUser.username || senderId,
            globalName: igUser.full_name || null,
          };
        }
      } catch (err) {
        console.warn(
          `[Instagram] Failed to fetch user info for ${senderId}:`,
          err.message,
        );
      }
    }

    const adapted = adaptMessage(
      data,
      realtime,
      userId,
      userInfo,
      context.username,
    );
    await services.messageHandler.handle(adapted);
  },
};
