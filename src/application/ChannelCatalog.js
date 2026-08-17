/**
 * Provides platform-neutral channel data for platform navigation.
 */
export class ChannelCatalog {
  constructor(channelRepository, messageRepository) {
    this.channelRepository = channelRepository;
    this.messageRepository = messageRepository;
  }

  async list({ platform, limit = 100 }) {
    const channels = await this.channelRepository.listByPlatform(platform);

    return await Promise.all(
      channels.map(async (channel) => {
        const messages =
          await this.messageRepository.getHistoryByPlatformChannelId(
            platform,
            channel.platformId,
            limit,
          );

        return toChannel(channel, messages);
      }),
    );
  }

  async create({ platform, platformChannelId, scope = "channel" }) {
    const channel = await this.channelRepository.upsert({
      platform,
      platformId: platformChannelId,
      scope,
    });

    return toChannel(channel, []);
  }
}

function toChannel(channel, messages) {
  return {
    id: channel.platformId,
    messageCount: channel._count?.messages ?? messages.length,
    updatedAt: channel.updatedAt,
    messages: messages.map((message) => ({
      id: message.platformId,
      authorPlatformId: message.author.platformId,
      content: message.content,
      createdAt: message.createdAt,
    })),
  };
}
