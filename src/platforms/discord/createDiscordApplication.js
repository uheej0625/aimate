import { createContainer } from "../../core/container.js";
import { loadCommands } from "./handlers/commandHandler.js";
import { loadEvents } from "./handlers/eventHandler.js";
import { DiscordLogRepository } from "./logging/DiscordLogRepository.js";
import { DiscordLogService } from "./logging/DiscordLogService.js";
import { DiscordParticipantSource } from "./DiscordParticipantSource.js";

export async function createDiscordApplication({
  configManager,
  client,
  credentials,
}) {
  const platformClients = new Map([["discord", client]]);

  const app = await createContainer({
    configManager,
    credentials,
    platformClients,
    participantSources: new Map([
      ["discord", new DiscordParticipantSource(client)],
    ]),
  });
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
    activateChannel: app.activateChannel,
    storedMessageService: app.storedMessageService,
    getGenerationInfo: app.getGenerationInfo,
    rerollConversation: app.rerollConversation,
    messageHandler: app.messageHandler,
  });

  return { ...app, discordLogService };
}
