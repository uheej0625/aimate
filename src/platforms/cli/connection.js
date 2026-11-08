import { createMockClient } from "./mocks.js";
import { getCliBotId } from "./constants.js";
import { PolicyRepository } from "../../repositories/PolicyRepository.js";
import { startRepl } from "./repl.js";
import { readCliHistory } from "./history.js";
import { MessageRepository } from "../../repositories/MessageRepository.js";

export function createCliConnection({ configManager, onQuit }) {
  const characterId = configManager.get("character");
  const client = createMockClient({ botId: getCliBotId(characterId) });
  const policies = new PolicyRepository(characterId);
  let app, tui;
  const connection = {
    platform: "cli",
    client,
    state: "idle",
    isReady: () => connection.state === "active",
    canUseTool: () => false,
    async isEnabled(channel) {
      if (!connection.isReady()) return false;
      const rows = await policies.list({
        platform: "cli",
        type: "conversation",
      });
      return rows.some(
        (row) =>
          row.scope === "channel" &&
          row.targetId === channel.platformChannelId &&
          row.effect === "allow",
      );
    },
    async attach(runtime) {
      app = runtime;
    },
    async prepare() {
      connection.state = "starting";
      await app.botAccountService.initBotAccount({
        platform: "cli",
        platformId: client.user.id,
      });
      if (connection.state === "starting") connection.state = "ready";
    },
    async activate() {
      connection.state = "active";
      const repository = new MessageRepository(configManager);
      const opening = startRepl({
        channelCatalog: app.channelCatalog,
        messageHandler: app.messageHandler,
        mockClient: client,
        readHistory: (channelId, options) =>
          readCliHistory(repository, channelId, options),
        onQuit,
      });
      app.pendingWork.add(opening);
      try {
        tui = await opening;
        if (connection.state !== "active") tui.close();
      } finally {
        app.pendingWork.delete(opening);
      }
    },
    stopInput() {
      connection.state = "stopped";
      tui?.close();
    },
    async close() {
      connection.stopInput();
      connection.state = "closed";
    },
  };
  return connection;
}
