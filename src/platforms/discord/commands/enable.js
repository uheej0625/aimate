import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { createLogger } from "../../../core/logger.js";

const logger = createLogger("Discord:Enable");

export default {
  data: new SlashCommandBuilder()
    .setName("활성화")
    .setDescription("DiscordMate 챗봇을 활성화 합니다.")
    .addStringOption((option) =>
      option
        .setName("스코프")
        .setDescription("이곳에서 일어난 일의 적용범위를 설정해 주세요.")
        .setRequired(true)
        .addChoices(
          { name: "글로벌", value: "global" },
          { name: "서버", value: "server" },
          { name: "채널", value: "channel" },
        ),
    ),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const scope = interaction.options.getString("스코프");
    const { channelRepository, serverRepository } = interaction.client.services;

    try {
      let serverId = null;

      // 서버/글로벌 스코프: 서버 레코드 확보
      if (scope === "server" || scope === "global") {
        if (interaction.guildId) {
          const server = await serverRepository.upsert({
            platform: "discord",
            platformId: interaction.guildId,
          });
          serverId = server.id;
        }
      }

      // 채널 스코프: 서버와 채널 레코드 확보
      if (scope === "channel") {
        if (interaction.guildId) {
          const server = await serverRepository.upsert({
            platform: "discord",
            platformId: interaction.guildId,
          });
          serverId = server.id;
        }
      }

      // 채널 레코드 생성 (이미 있으면 업데이트)
      await channelRepository.upsert({
        platform: "discord",
        platformId: interaction.channelId,
        serverId,
        scope,
      });

      const scopeLabel =
        scope === "global" ? "글로벌" : scope === "server" ? "서버" : "채널";

      await interaction.editReply({
        content: `✅ 이 채널이 **${scopeLabel}** 스코프로 활성화되었습니다.`,
      });
    } catch (error) {
      logger.error({ err: error }, "활성화 오류");
      await interaction.editReply({
        content: "❌ 활성화 중 오류가 발생했습니다.",
      });
    }
  },
};
