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
    sentAt: discordMessage.createdAt ?? null,
    editedAt: discordMessage.editedAt ?? null,
    ...(discordMessage.reference?.messageId
      ? { replyToMessageId: discordMessage.reference.messageId }
      : {}),
    ...(discordMessage.mentions?.users?.size
      ? { mentionedUserIds: [...discordMessage.mentions.users.keys()] }
      : {}),
    attachments: [...(discordMessage.attachments?.values() ?? [])].map(
      (attachment) => ({
        id: attachment.id,
        name: attachment.name,
        url: attachment.url,
        contentType: attachment.contentType ?? null,
      }),
    ),
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
    constraints: { maxTextLength: 2000, attachments: true },
    readHistory: async ({ limit, before }) => {
      const messages = await discordChannel.messages.fetch({
        limit,
        before,
        cache: false,
      });
      return [...messages.values()].reverse().map(adaptMessageData);
    },
    readMessage: async (platformMessageId) =>
      adaptMessageData(
        await discordChannel.messages.fetch({
          message: platformMessageId,
          force: true,
        }),
      ),
    send: async (message) => {
      const sentMessage = await discordChannel.send(toDiscordPayload(message));
      return adaptMessageData(sentMessage);
    },
    sendTyping: () => discordChannel.sendTyping(),
    reply: async (platformMessageId, message) => {
      const sentMessage = await discordChannel.send({
        ...toDiscordPayload(message),
        reply: { messageReference: platformMessageId, failIfNotExists: true },
        allowedMentions: { repliedUser: false },
      });
      return adaptMessageData(sentMessage);
    },
    react: async (platformMessageId, emoji, { abortSignal } = {}) => {
      const target = await discordChannel.messages.fetch({
        message: platformMessageId,
        force: true,
      });
      abortSignal?.throwIfAborted();
      await target.react(emoji);
    },
  };
}

/**
 * Discord.js Message를 MessageHandler 입력으로 변환한다.
 *
 * @param {import('discord.js').Message} discordMessage
 * @returns {import('../../application/contracts.js').MessageEvent}
 */
export function adaptIncomingMessage(discordMessage, kind = "CREATE") {
  return {
    kind,
    platformMessageId: discordMessage.id,
    ...(discordMessage.partial
      ? {
          loadMessage: async () =>
            adaptMessageData(await discordMessage.fetch()),
        }
      : { message: adaptMessageData(discordMessage) }),
    channel: adaptChannel(discordMessage.channel),
    botId: discordMessage.client.user.id,
  };
}

/**
 * Discord deletion payloads only need message IDs and channel context.
 * @param {Iterable<import('discord.js').Message>} discordMessages
 * @param {import('discord.js').TextBasedChannel} discordChannel
 * @returns {import('../../application/contracts.js').MessageEvent}
 */
export function adaptMessageDeletion(discordMessages, discordChannel) {
  return {
    kind: "DELETE",
    platformMessageIds: [...discordMessages].map((message) => message.id),
    channel: adaptChannel(discordChannel),
    botId: discordChannel.client.user.id,
  };
}

function toDiscordPayload({ files, ...message }) {
  return {
    ...message,
    ...(files?.length
      ? {
          files: files.map(({ path, name }) => ({
            attachment: path,
            ...(name ? { name } : {}),
          })),
        }
      : {}),
  };
}
