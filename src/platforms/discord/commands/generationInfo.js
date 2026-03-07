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
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { messageRepository } = interaction.client.services;
    const target = interaction.targetMessage;

    // DB에서 메시지 조회 (generation 포함)
    const dbMessage = await messageRepository.findByPlatformId(
      "discord",
      target.id,
    );

    if (!dbMessage) {
      return interaction.editReply({
        content: "❌ 이 메시지는 데이터베이스에 저장되어 있지 않습니다.",
      });
    }

    if (!dbMessage.generation) {
      return interaction.editReply({
        content: "ℹ️ 이 메시지는 어떤 Generation에도 연결되어 있지 않습니다.",
      });
    }

    const gen = dbMessage.generation;

    const responseMessages = gen.responseMessagesJson
      ? JSON.parse(gen.responseMessagesJson)
      : [];
    const emotionDelta = gen.emotionDeltaJson
      ? JSON.parse(gen.emotionDeltaJson)
      : null;
    const contextMessageIds = gen.messageIdsJson
      ? JSON.parse(gen.messageIdsJson)
      : [];

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
          name: "컨텍스트 메시지 수",
          value: `${contextMessageIds.length}개`,
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
    if (responseMessages.length > 0) {
      const responseText = responseMessages
        .map((msg, i) => `**[${i + 1}]** ${msg}`)
        .join("\n")
        .slice(0, 1024);
      embed.addFields({ name: "AI 응답", value: responseText });
    }

    // 감정 변화
    if (emotionDelta) {
      const deltaText = Object.entries(emotionDelta)
        .filter(([, v]) => v !== 0)
        .map(([k, v]) => `${k}: ${v > 0 ? "+" : ""}${v}`)
        .join(", ");
      if (deltaText) {
        embed.addFields({
          name: "감정 변화",
          value: deltaText,
          inline: true,
        });
      }
    }

    // 감정 변화 이유
    if (gen.emotionReason) {
      embed.addFields({
        name: "감정 변화 이유",
        value: gen.emotionReason,
        inline: true,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
