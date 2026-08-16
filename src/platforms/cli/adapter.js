/**
 * CLI 플랫폼 어댑터
 * CLI에서 생성된 원시 데이터를 플랫폼 독립적인 계약으로 변환한다.
 *
 * @see ../../application/contracts.js
 */

/**
 * CLI 원시 메시지에서 저장·처리에 필요한 순수 데이터만 추출한다.
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
 * @returns {import('../../application/contracts.js').NormalizedMessage}
 */
export function adaptMessageData(raw) {
  return {
    platform: "cli",
    platformMessageId: raw.id,
    platformChannelId: raw.channelId,
    platformServerId: raw.guildId ?? null,
    content: raw.content,
    author: {
      platformUserId: raw.author.id,
      handle: raw.author.username,
      displayName: raw.author.globalName ?? null,
      isBot: raw.author.bot ?? false,
    },
  };
}

/**
 * CLI 원시 메시지를 MessageHandler 입력으로 변환한다.
 *
 * @param {Object} raw
 * @param {import('../../application/contracts.js').ChannelPort} raw.channel
 * @param {{user: {id: string}}} raw.client
 * @returns {import('../../application/contracts.js').IncomingMessageRequest}
 */
export function adaptIncomingMessage(raw) {
  return {
    message: adaptMessageData(raw),
    channel: raw.channel,
    botId: raw.client.user.id,
  };
}
