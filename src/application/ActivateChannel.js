/**
 * Activates a platform channel without exposing repositories to adapters.
 */
export class ActivateChannel {
  constructor(channelRepository, serverRepository) {
    this.channelRepository = channelRepository;
    this.serverRepository = serverRepository;
  }

  async execute({
    platform,
    platformChannelId,
    platformServerId = null,
    scope,
  }) {
    let serverId = null;

    if (platformServerId) {
      const server = await this.serverRepository.upsert({
        platform,
        platformId: platformServerId,
      });
      serverId = server.id;
    }

    return await this.channelRepository.upsert({
      platform,
      platformId: platformChannelId,
      serverId,
      scope,
    });
  }
}
