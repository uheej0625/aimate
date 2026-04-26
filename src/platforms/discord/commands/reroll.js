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
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetMessage = interaction.targetMessage;
    const messageRepository = interaction.client.services.messageRepository;
    const chatFlow = interaction.client.services.chatFlow;

    // DB에서 대상 메시지 조회
    const dbMessage = await messageRepository.findByPlatformId(
      "discord",
      targetMessage.id,
    );

    if (!dbMessage || !dbMessage.generationId) {
      await interaction.editReply({
        content:
          "재생성할 수 없는 메시지입니다. (DB 정보 없거나 Generation ID 없음)",
      });
      return;
    }

    // 동일 generationId를 가진 모든 메시지 조회 (MessageRepository에 메소드 필요)
    const generationMessages = await messageRepository.findByGenerationId(
      dbMessage.generationId,
    );
    if (!generationMessages || generationMessages.length === 0) {
      await interaction.editReply({
        content: "해당 생성 회차(Generation)의 메시지를 찾을 수 없습니다.",
      });
      return;
    }

    const platformIds = generationMessages.map((m) => m.platformId);

    // Discord에서 메시지 삭제
    for (const pid of platformIds) {
      try {
        const msgToDelete = await interaction.channel.messages.fetch(pid);
        if (msgToDelete) {
          await msgToDelete.delete();
        }
      } catch (error) {
        logger.warn(
          { err: error, platformId: pid },
          "Discord 메시지 개별 삭제 실패 (이미 지워졌을 수 있음)",
        );
      }
    }

    // DB에서 메시지 삭제
    const deletedCount = await messageRepository.deleteManyByPlatformIds(
      "discord",
      platformIds,
    );

    logger.info(
      { generationId: dbMessage.generationId, deletedCount },
      "재생성(Reroll)을 위해 기존 메시지 삭제 완료",
    );

    await interaction.editReply({
      content: `기존 메시지 삭제완료. 다시 답변을 생성합니다...`,
    });

    // 다시 ChatFlow 실행
    try {
      const adaptedChannel = adaptChannel(interaction.channel);
      await chatFlow.execute(adaptedChannel, interaction.client.user.id);
    } catch (err) {
      logger.error({ err }, "재생성(Reroll) 중 ChatFlow 실행 실패");
    }
  },
};
