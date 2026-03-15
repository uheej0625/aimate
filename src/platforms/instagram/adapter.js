/**
 * Instagram 플랫폼 어댑터
 * Instagram MQTT 메시지를 내부 표준 형식(AdaptedMessage / AdaptedChannel)으로 변환한다.
 *
 * @see docs/message-format.md
 */

/**
 * Instagram realtime 메시지 이벤트를 내부 표준 메시지 형식으로 변환한다.
 *
 * @param {Object} data - realtime 'message' 이벤트 데이터
 * @param {Object} data.message - 메시지 객체
 * @param {Object} realtimeClient - RealtimeClient 인스턴스
 * @param {string} botPlatformId - 봇의 Instagram platform ID
 * @param {Object} [userInfo] - { username, globalName } (옵션)
 * @param {string} [botUsername] - 봇의 Instagram username (옵션)
 * @returns {import('../../../docs/message-format').AdaptedMessage}
 */
export function adaptMessage(
  data,
  realtimeClient,
  botPlatformId,
  userInfo = null,
  botUsername = null,
) {
  const msg = data.message;
  const threadId = msg.thread_id;
  const senderId = String(
    msg.from_user_id ?? msg.user_id ?? msg.sender_id ?? "unknown",
  );

  return {
    id: msg.item_id,
    content: msg.text ?? "",
    platform: "instagram",
    channelId: threadId,
    guildId: null, // Instagram DM에는 서버/길드 개념 없음
    author: {
      id: senderId,
      username: userInfo?.username ?? senderId, // 실시간 이벤트에는 username 없음
      globalName: userInfo?.globalName ?? null,
      bot: false,
    },
    channel: adaptChannel(threadId, realtimeClient, botPlatformId, botUsername),
    client: {
      user: { id: botPlatformId, username: botUsername ?? botPlatformId },
    },
  };
}

/**
 * Instagram thread를 내부 표준 채널 형식으로 변환한다.
 *
 * @param {string} threadId - Instagram DM thread ID
 * @param {Object} realtimeClient - RealtimeClient 인스턴스
 * @param {string} botPlatformId - 봇의 Instagram platform ID
 * @param {string} [botUsername] - 봇의 Instagram username (옵션)
 * @returns {import('../../../docs/message-format').AdaptedChannel}
 */
export function adaptChannel(
  threadId,
  realtimeClient,
  botPlatformId,
  botUsername = null,
) {
  return {
    id: threadId,
    type: 1, // DM
    platform: "instagram",
    send: async (content) => {
      await realtimeClient.directCommands.sendTextViaRealtime(
        threadId,
        content,
      );

      // Instagram MQTT 전송은 메시지 객체를 반환하지 않으므로 합성
      return {
        id: `ig_sent_${Date.now()}`,
        content,
        platform: "instagram",
        channelId: threadId,
        guildId: null,
        author: {
          id: botPlatformId,
          username: botUsername ?? botPlatformId,
          globalName: null,
          bot: true,
        },
        channel: adaptChannel(
          threadId,
          realtimeClient,
          botPlatformId,
          botUsername,
        ),
        client: {
          user: { id: botPlatformId, username: botUsername ?? botPlatformId },
        },
      };
    },
    sendTyping: async () => {
      try {
        await realtimeClient.directCommands.indicateActivity({
          threadId,
          isActive: true,
        });
      } catch {
        // 타이핑 인디케이터 실패는 무시
      }
    },
  };
}
