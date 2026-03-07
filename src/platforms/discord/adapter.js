/**
 * Discord 플랫폼 어댑터
 * Discord.js 객체를 내부 표준 형식(AdaptedMessage / AdaptedChannel)으로 변환한다.
 *
 * @see docs/message-format.md
 */

/**
 * Discord.js Message를 내부 표준 메시지 형식으로 변환한다.
 *
 * @param {import('discord.js').Message} discordMessage
 * @returns {import('../../../docs/message-format').AdaptedMessage}
 */
export function adaptMessage(discordMessage) {
  return {
    id: discordMessage.id,
    content: discordMessage.content,
    platform: "discord",
    channelId: discordMessage.channelId,
    guildId: discordMessage.guildId ?? null,
    author: {
      id: discordMessage.author.id,
      username: discordMessage.author.username,
      globalName: discordMessage.author.globalName ?? null,
      bot: discordMessage.author.bot,
    },
    channel: adaptChannel(discordMessage.channel),
    client: { user: { id: discordMessage.client.user.id } },
  };
}

/**
 * Discord.js TextBasedChannel을 내부 표준 채널 형식으로 변환한다.
 * send()가 반환하는 메시지도 자동으로 표준 형식으로 래핑된다.
 *
 * @param {import('discord.js').TextBasedChannel} discordChannel
 * @returns {import('../../../docs/message-format').AdaptedChannel}
 */
export function adaptChannel(discordChannel) {
  return {
    id: discordChannel.id,
    type: discordChannel.type,
    platform: "discord",
    send: async (content) => {
      const msg = await discordChannel.send(content);
      return adaptMessage(msg);
    },
    sendTyping: () => discordChannel.sendTyping(),
  };
}
