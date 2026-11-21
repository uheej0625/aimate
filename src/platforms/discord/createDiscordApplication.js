import { loadCommands } from "./handlers/commandHandler.js";
import { loadEvents } from "./handlers/eventHandler.js";
import { DiscordLogRepository } from "./logging/DiscordLogRepository.js";
import { DiscordLogService } from "./logging/DiscordLogService.js";
import { DiscordParticipantSource } from "./DiscordParticipantSource.js";
import { PolicyRepository } from "../../repositories/PolicyRepository.js";
import { ChannelRepository } from "../../repositories/ChannelRepository.js";
import { PolicyType } from "../../policies/Policy.js";
import { DiscordPolicyService } from "./policy/DiscordPolicyService.js";
import { getRequiredDiscordToken } from "./credentials.js";
import { createDiscordClient } from "./client.js";
import { drain } from "../../core/drain.js";

export function createDiscordConnection({
  configManager,
  client = createDiscordClient(),
  env = process.env,
}) {
  const characterId = configManager.get("character");
  const policy = new DiscordPolicyService({
    client,
    repository: new PolicyRepository(characterId),
    channelRepository: new ChannelRepository(),
    allowDirectMessages: configManager.get("features.enableDM") === true,
  });
  let app, logs, closing;
  const connection = {
    platform: "discord",
    client,
    state: "idle",
    participantSource: new DiscordParticipantSource(client),
    isReady: () =>
      connection.state === "active" && client.isReady?.() !== false,
    isEnabled: (channel) =>
      connection.isReady() &&
      policy.isAllowed(channel, PolicyType.CONVERSATION),
    canUseTool: (tool) =>
      connection.isReady() &&
      ["set_discord_status", "set_discord_activity"].includes(tool.name),
    async attach(runtime) {
      app = runtime;
      logs = new DiscordLogService({
        client,
        repository: new DiscordLogRepository(characterId),
        eventBus: app.eventBus,
        conversationBuffer: app.conversationBuffer,
        configManager,
      });
      await loadEvents(client, {
        characterId,
        pendingWork: app.pendingWork,
        isAccountReady: connection.isReady,
        discordLogService: logs,
        messageHandler: {
          async handle(event) {
            const result = await app.messageHandler.handle(event);
            if (result.changed || result.observedChanged) void logs.refresh();
            return result;
          },
        },
      });
      await loadCommands(client, {
        discordLogService: logs,
        discordPolicyService: policy,
        storedMessageService: app.storedMessageService,
        getGenerationInfo: app.getGenerationInfo,
        rerollConversation: app.rerollConversation,
      });
    },
    async prepare() {
      connection.state = "starting";
      await client.login(getRequiredDiscordToken(configManager, env));
      if (connection.state !== "starting") return;
      await app.botAccountService.initBotAccount({
        platform: "discord",
        platformId: client.user.id,
        handle: client.user.username,
        displayName: client.user.globalName,
      });
      if (connection.state === "starting") connection.state = "ready";
    },
    async activate() {
      connection.state = "active";
      policy.start(() => app.messageHandler.stopDisabledConversations());
      logs.start();
    },
    stopInput() {
      if (connection.state === "closed") return;
      connection.state = "stopped";
      policy.stop();
      logs?.stop();
    },
    close() {
      closing ??= (async () => {
        connection.stopInput();
        try {
          await drain([policy.close(), logs?.close()]);
        } finally {
          await client.destroy();
          connection.state = "closed";
        }
      })();
      return closing;
    },
  };
  return connection;
}
