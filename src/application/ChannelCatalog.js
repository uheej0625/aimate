/**
 * Provides platform-neutral channel data for platform navigation.
 */
export class ChannelCatalog {
  constructor(channelRepository, messageRepository, policyRepository) {
    this.channelRepository = channelRepository;
    this.messageRepository = messageRepository;
    this.policyRepository = policyRepository;
  }

  async list({ platform, limit = 100 }) {
    const policies = await this.policyRepository.list({
      platform,
      type: "conversation",
    });
    const channels = (
      await this.channelRepository.listByPlatform(platform)
    ).filter((channel) =>
      policies.some(
        (policy) =>
          policy.scope === "channel" &&
          policy.targetId === channel.platformId &&
          policy.effect === "allow",
      ),
    );

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

  async create({ platform, platformChannelId }) {
    const channel = await this.channelRepository.upsert({
      platform,
      platformId: platformChannelId,
    });
    await this.policyRepository.set({
      platform,
      type: "conversation",
      scope: "channel",
      targetId: platformChannelId,
      effect: "allow",
      updatedBy: "local-cli",
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
