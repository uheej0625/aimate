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
    const { realtime, userId, services } = context;
    const msg = data.message;

    // 텍스트가 없는 메시지(사진, 비디오, 리액션 등)는 무시
    if (!msg?.text) return;

    // Instagram DM은 /enable 명령이 없으므로 채널을 자동 활성화
    await services.channelRepository.upsert({
      platform: "instagram",
      platformId: msg.thread_id,
      serverId: null,
    });

    const adapted = adaptMessage(data, realtime, userId);
    await services.messageHandler.handle(adapted);
  },
};
