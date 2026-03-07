import { ApplicationCommandType, MessageFlags } from "discord.js";

export default {
  data: {
    name: "이 메세지만 삭제",
    type: ApplicationCommandType.Message,
  },
  /**
   * 메시지를 삭제합니다
   * @param {import("discord.js").MessageContextMenuCommandInteraction} interaction
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetMessage = interaction.targetMessage;
    const messageRepository = interaction.client.services.messageRepository;

    // Discord에서 메시지 삭제
    try {
      await targetMessage.delete();
    } catch (error) {
      console.error("❌ Discord 메시지 삭제 실패:", error);
      await interaction.editReply({
        content: "메시지를 삭제할 권한이 없거나 이미 삭제된 메시지입니다.",
      });
      return;
    }

    // DB에서 메시지 삭제
    const deleted = await messageRepository.deleteByPlatformId(
      "discord",
      targetMessage.id,
    );

    if (deleted) {
      await interaction.editReply({ content: "메시지를 삭제했습니다." });
    } else {
      await interaction.editReply({
        content: "메시지를 Discord에서 삭제했습니다. (DB에 기록 없음)",
      });
    }
  },
};
