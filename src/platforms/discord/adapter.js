/**
 * Discord 플랫폼 어댑터
 * Discord.js 객체를 플랫폼 독립적인 메시지와 채널 계약으로 변환한다.
 *
 * @see ../../application/contracts.js
 */

/**
 * Discord.js Message에서 저장·처리에 필요한 순수 데이터만 추출한다.
 *
 * @param {import('discord.js').Message} discordMessage
 * @returns {import('../../application/contracts.js').NormalizedMessage}
 */
export function adaptMessageData(discordMessage) {
  return {
    platform: "discord",
    platformMessageId: discordMessage.id,
    platformChannelId: discordMessage.channelId,
    platformServerId: discordMessage.guildId ?? null,
    content: discordMessage.content,
    author: {
      platformUserId: discordMessage.author.id,
      handle: discordMessage.author.username,
      displayName: discordMessage.author.globalName ?? null,
      isBot: discordMessage.author.bot,
    },
  };
}

/**
 * Discord.js TextBasedChannel을 내부 표준 채널 형식으로 변환한다.
 * send()가 반환하는 메시지도 자동으로 표준 형식으로 래핑된다.
 *
 * @param {import('discord.js').TextBasedChannel} discordChannel
 * @returns {import('../../application/contracts.js').ChannelPort}
 */
export function adaptChannel(discordChannel) {
  return {
    platform: "discord",
    platformChannelId: discordChannel.id,
    send: async (message) => {
      const sentMessage = await discordChannel.send(message);
      return adaptMessageData(sentMessage);
    },
    sendTyping: () => discordChannel.sendTyping(),
  };
}

/**
 * Discord.js Message를 MessageHandler 입력으로 변환한다.
 *
 * @param {import('discord.js').Message} discordMessage
 * @returns {import('../../application/contracts.js').IncomingMessageRequest}
 */
export function adaptIncomingMessage(discordMessage) {
  return {
    message: adaptMessageData(discordMessage),
    channel: adaptChannel(discordMessage.channel),
    botId: discordMessage.client.user.id,
  };
}
