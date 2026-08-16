import { ApplicationCommandType, EmbedBuilder, MessageFlags } from "discord.js";

export default {
  data: {
    name: "생성 정보 확인",
    type: ApplicationCommandType.Message,
  },
  /**
   * 메시지 생성 정보를 확인합니다
   * @param {import("discord.js").MessageContextMenuCommandInteraction} interaction
   */
  async execute(interaction, { getGenerationInfo }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.targetMessage;

    const info = await getGenerationInfo.execute({
      platform: "discord",
      platformMessageId: target.id,
    });

    if (!info) {
      return interaction.editReply({
        content: "❌ 이 메시지는 데이터베이스에 저장되어 있지 않습니다.",
      });
    }

    if (!info.generation) {
      return interaction.editReply({
        content: "ℹ️ 이 메시지는 어떤 Generation에도 연결되어 있지 않습니다.",
      });
    }

    const gen = info.generation;

    // 상태 이모지
    const statusEmoji = {
      PENDING: "⏳",
      PROCESSING: "⚙️",
      GENERATED: "📝",
      COMPLETED: "✅",
      CANCELLED: "🚫",
      FAILED: "❌",
    };

    const embed = new EmbedBuilder()
      .setTitle(`Generation #${gen.id}`)
      .setColor(
        gen.status === "COMPLETED"
          ? 0x57f287
          : gen.status === "FAILED"
            ? 0xed4245
            : gen.status === "CANCELLED"
              ? 0x95a5a6
              : 0x5865f2,
      )
      .addFields(
        {
          name: "상태",
          value: `${statusEmoji[gen.status] ?? "❓"} ${gen.status}`,
          inline: true,
        },
        {
          name: "입력 메시지 수",
          value: `${gen.inputMessages.length}개`,
          inline: true,
        },
        {
          name: "생성 시각",
          value: `<t:${Math.floor(new Date(gen.createdAt).getTime() / 1000)}:R>`,
          inline: true,
        },
      )
      .setTimestamp(new Date(gen.updatedAt));

    // AI 응답 메시지
    if (gen.outputMessages.length > 0) {
      const responseText = gen.outputMessages
        .map((msg, i) => `**[${i + 1}]** ${msg}`)
        .join("\n")
        .slice(0, 1024);
      embed.addFields({ name: "AI 응답", value: responseText });
    }

    if (gen.inputMessages.length > 0) {
      const inputText = gen.inputMessages
        .map((message, i) => `**[${i + 1}]** ${message.content}`)
        .join("\n")
        .slice(0, 1024);
      embed.addFields({ name: "입력 메시지", value: inputText });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
