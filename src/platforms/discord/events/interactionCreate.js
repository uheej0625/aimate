import { Events } from "discord.js";
import {
  createLogger,
  elapsedMs,
  withLogContext,
} from "../../../core/logger.js";

const logger = createLogger("Discord:Interaction");

/**
 * InteractionCreate 이벤트
 * 슬래시 커맨드 등의 인터랙션을 처리
 */
export default {
  name: Events.InteractionCreate,
  async execute(interaction, { client, discordLogService }) {
    const logButton =
      interaction.isButton?.() &&
      interaction.customId.startsWith("aimate-log:");
    // Commands and the two log-original buttons share acknowledgement/error handling.
    if (
      !logButton &&
      !interaction.isChatInputCommand() &&
      !interaction.isMessageContextMenuCommand()
    )
      return;

    return withLogContext(
      {
        platform: "discord",
        platformChannelId: interaction.channelId,
        interactionId: interaction.id,
        commandName: interaction.commandName,
        platformUserId: interaction.user?.id,
      },
      async () => {
        const command = logButton
          ? { execute: () => discordLogService.showOriginal(interaction) }
          : client.commands.get(interaction.commandName);

        if (!command) {
          logger.error({ event: "command.not_found" }, "Command not found");
          return;
        }

        const startedAt = performance.now();
        logger.info({ event: "command.started" }, "Command started");
        try {
          await command.execute(interaction);
          logger.info(
            { event: "command.completed", durationMs: elapsedMs(startedAt) },
            "Command handler completed",
          );
        } catch (error) {
          logger.error(
            {
              event: "command.failed",
              err: error,
              durationMs: elapsedMs(startedAt),
            },
            "Error executing command",
          );

          const errorMessage = {
            content: "명령어 실행 중 오류가 발생했습니다.",
            ephemeral: true,
          };

          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
          } else {
            await interaction.reply(errorMessage);
          }
        }
      },
    );
  },
};
