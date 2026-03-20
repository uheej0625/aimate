import { Events } from "discord.js";
import { createLogger } from "../../../core/logger.js";

const logger = createLogger("Discord:Interaction");

/**
 * InteractionCreate 이벤트
 * 슬래시 커맨드 등의 인터랙션을 처리
 */
export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // 슬래시 커맨드 또는 메시지 컨텍스트 메뉴 커맨드만 처리
    if (
      !interaction.isChatInputCommand() &&
      !interaction.isMessageContextMenuCommand()
    )
      return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      logger.error(
        { commandName: interaction.commandName },
        "Command not found",
      );
      return;
    }

    try {
      await command.execute(interaction);
      logger.info(
        { user: interaction.user.tag, command: interaction.commandName },
        "Command executed",
      );
    } catch (error) {
      logger.error(
        { err: error, command: interaction.commandName },
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
};
