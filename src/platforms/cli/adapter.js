/**
 * CLI 플랫폼 어댑터
 * CLI에서 생성된 원시 데이터를 내부 표준 형식(AdaptedMessage)으로 변환한다.
 *
 * @see docs/message-format.md
 */

/**
 * CLI 원시 메시지 데이터를 내부 표준 메시지 형식으로 변환한다.
 *
 * @param {Object} raw - CLI에서 생성된 원시 메시지 데이터
 * @param {string} raw.id
 * @param {string} raw.content
 * @param {string} raw.channelId
 * @param {string|null} [raw.guildId]
 * @param {Object} raw.author
 * @param {string} raw.author.id
 * @param {string} raw.author.username
 * @param {string|null} [raw.author.globalName]
 * @param {boolean} [raw.author.bot]
 * @param {Object} raw.channel - 이미 표준 형식을 따르는 채널 객체
 * @param {Object} raw.client - { user: { id: string } }
 * @returns {import('../../../docs/message-format').AdaptedMessage}
 */
export function adaptMessage(raw) {
  return {
    id: raw.id,
    content: raw.content,
    platform: "cli",
    channelId: raw.channelId,
    guildId: raw.guildId ?? null,
    author: {
      id: raw.author.id,
      username: raw.author.username,
      globalName: raw.author.globalName ?? null,
      bot: raw.author.bot ?? false,
    },
    channel: raw.channel,
    client: raw.client,
  };
}
