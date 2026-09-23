import { createContainer } from "../../core/container.js";
import { loadCommands } from "./handlers/commandHandler.js";
import { loadEvents } from "./handlers/eventHandler.js";

export async function createDiscordApplication({ configManager, client }) {
  const platformClients = new Map([["discord", client]]);

  const app = await createContainer({
    configManager,
    platformClients,
  });

  await loadEvents(client, {
    messageHandler: app.messageHandler,
    botAccountService: app.botAccountService,
  });
  await loadCommands(client, {
    activateChannel: app.activateChannel,
    storedMessageService: app.storedMessageService,
    getGenerationInfo: app.getGenerationInfo,
    rerollConversation: app.rerollConversation,
    messageHandler: app.messageHandler,
  });

  return app;
}
