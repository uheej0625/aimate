import { createContainer } from "../../core/container.js";
import { adaptChannel } from "./adapter.js";
import { loadCommands } from "./handlers/commandHandler.js";
import { loadEvents } from "./handlers/eventHandler.js";
import { registerDiscordPolicies } from "./registerDiscordPolicies.js";

export async function createDiscordApplication({ configManager, client }) {
  const platformClients = new Map([["discord", client]]);
  const platformDispatchers = new Map([
    [
      "discord",
      {
        async resolveChannel(job) {
          const channel = await client.channels.fetch(job.channel.platformId);
          return channel ? adaptChannel(channel) : null;
        },
        getBotId() {
          return client.user?.id ?? "bot";
        },
      },
    ],
  ]);

  const app = await createContainer({
    configManager,
    platformClients,
    platformDispatchers,
  });

  registerDiscordPolicies({
    eventBus: app.eventBus,
    client,
    configManager,
  });

  await loadEvents(client, {
    messageHandler: app.messageHandler,
    botAccountService: app.botAccountService,
  });
  await loadCommands(client, {
    messageRepository: app.messageRepository,
    channelRepository: app.channelRepository,
    serverRepository: app.serverRepository,
    chatFlow: app.chatFlow,
  });

  return app;
}
