import { createContainer } from "../../core/container.js";
import { loadCommands } from "./handlers/commandHandler.js";
import { loadEvents } from "./handlers/eventHandler.js";
import { DiscordLogRepository } from "./logging/DiscordLogRepository.js";
import { DiscordLogService } from "./logging/DiscordLogService.js";
import { DiscordParticipantSource } from "./DiscordParticipantSource.js";
import { PolicyRepository } from "../../repositories/PolicyRepository.js";
import { ChannelRepository } from "../../repositories/ChannelRepository.js";
import { PolicyType } from "../../policies/Policy.js";
import { DiscordPolicyService } from "./policy/DiscordPolicyService.js";

export async function createDiscordApplication({
  configManager,
  client,
  credentials,
}) {
  const platformClients = new Map([["discord", client]]);
  const discordPolicyService = new DiscordPolicyService({
    client,
    repository: new PolicyRepository(),
    channelRepository: new ChannelRepository(),
  });

  const app = await createContainer({
    configManager,
    credentials,
    platformClients,
    conversationPolicy: {
      isEnabled: (channel) =>
        discordPolicyService.isAllowed(channel, PolicyType.CONVERSATION),
    },
    participantSources: new Map([
      ["discord", new DiscordParticipantSource(client)],
    ]),
  });
  discordPolicyService.start(() =>
    app.messageHandler.stopDisabledConversations(),
  );
  const discordLogService = new DiscordLogService({
    client,
    repository: new DiscordLogRepository(),
    eventBus: app.eventBus,
    conversationBuffer: app.conversationBuffer,
    configManager,
  });
  discordLogService.start();

  await loadEvents(client, {
    discordLogService,
    messageHandler: {
      async handle(event) {
        const result = await app.messageHandler.handle(event);
        if (result.changed) void discordLogService.refresh();
        return result;
      },
    },
    botAccountService: app.botAccountService,
  });
  await loadCommands(client, {
    discordLogService,
    discordPolicyService,
    storedMessageService: app.storedMessageService,
    getGenerationInfo: app.getGenerationInfo,
    rerollConversation: app.rerollConversation,
    messageHandler: app.messageHandler,
  });

  return { ...app, discordLogService, discordPolicyService };
}
