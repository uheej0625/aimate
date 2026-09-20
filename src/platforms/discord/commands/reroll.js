import { ApplicationCommandType, MessageFlags } from "discord.js";
import { createLogger } from "../../../core/logger.js";
import { adaptChannel } from "../adapter.js";

const logger = createLogger("Discord:Reroll");

export default {
  data: {
    name: "재생성",
    type: ApplicationCommandType.Message,
  },
  /**
   * 해당 Generation에 속한 봇의 메시지를 모두 삭제하고 재생성합니다.
   * @param {import("discord.js").MessageContextMenuCommandInteraction} interaction
   */
  async execute(interaction, { rerollConversation }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const plan = await rerollConversation.prepare({
      platform: "discord",
      platformMessageId: interaction.targetMessage.id,
    });

    if (plan.status === "NOT_REROLLABLE") {
      await interaction.editReply({
        content:
          "재생성할 수 없는 메시지입니다. (DB 정보 없거나 Generation ID 없음)",
      });
      return;
    }

    if (plan.status === "MESSAGES_NOT_FOUND") {
      await interaction.editReply({
        content: "해당 생성 회차(Generation)의 메시지를 찾을 수 없습니다.",
      });
      return;
    }

    const deletedIds = [];
    // Discord에서 메시지 삭제
    for (const platformMessageId of plan.platformMessageIds) {
      try {
        const msgToDelete =
          await interaction.channel.messages.fetch(platformMessageId);
        if (msgToDelete) {
          await msgToDelete.delete();
          deletedIds.push(platformMessageId);
        }
      } catch (error) {
        if (error.code === 10008) deletedIds.push(platformMessageId);
        logger.warn(
          { err: error, platformId: platformMessageId },
          "Discord 메시지 개별 삭제 실패 (이미 지워졌을 수 있음)",
        );
      }
    }

    await interaction.editReply({
      content: `${deletedIds.length}개 메시지를 삭제했습니다.${deletedIds.length < plan.platformMessageIds.length ? " 일부 메시지는 삭제하지 못했습니다." : ""} 다시 답변을 생성합니다...`,
    });

    // 다시 ChatFlow 실행
    try {
      const adaptedChannel = adaptChannel(interaction.channel);
      const { deletedCount } = await rerollConversation.execute({
        platform: "discord",
        platformMessageIds: deletedIds,
        generationId: plan.generationId,
        conversationRequest: {
          channelPort: adaptedChannel,
          internalChannelId: plan.internalChannelId,
          botId: interaction.client.user.id,
        },
      });
      logger.info(
        { generationId: plan.generationId, deletedCount },
        "재생성(Reroll)을 위해 기존 메시지 삭제 완료",
      );
    } catch (err) {
      logger.error({ err }, "재생성(Reroll) 중 ChatFlow 실행 실패");
    }
  },
};
