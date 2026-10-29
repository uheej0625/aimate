import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("로그")
    .setDescription("AiMate 로그를 채널에서 확인합니다.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((command) =>
      command
        .setName("채널")
        .setDescription("이 서버의 생성 로그를 받을 채널을 설정합니다.")
        .addStringOption((option) =>
          option
            .setName("상태")
            .setDescription("로그 수신 여부")
            .setRequired(true)
            .addChoices(
              { name: "활성화", value: "enable" },
              { name: "비활성화", value: "disable" },
            ),
        )
        .addChannelOption((option) =>
          option
            .setName("대상")
            .setDescription("로그를 받을 채널 (기본: 현재 채널)")
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
            ),
        ),
    ),

  async execute(interaction, { discordLogService }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (
      !interaction.guildId ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      return await interaction.editReply({
        content: "서버 관리 권한이 있어야 로그 채널을 설정할 수 있어요.",
      });
    }
    const channel =
      interaction.options.getChannel("대상") ?? interaction.channel;
    const enabled = interaction.options.getString("상태", true) === "enable";
    if (
      !channel ||
      channel.guildId !== interaction.guildId ||
      ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(
        channel.type,
      )
    ) {
      return await interaction.editReply({
        content: "이 서버의 텍스트 채널이나 공지 채널을 선택해 주세요.",
      });
    }
    if (enabled) {
      const permissions = channel.permissionsFor(interaction.client.user);
      if (
        !permissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
      ) {
        return await interaction.editReply({
          content:
            "이 채널에서 봇에게 채널 보기 · 메시지 보내기 · 링크 임베드 권한이 필요해요.",
        });
      }
    }
    await discordLogService.configure({
      guildId: interaction.guildId,
      channelId: channel.id,
      enabled,
    });
    const embed = new EmbedBuilder()
      .setColor(enabled ? 0x34d399 : 0x94a3b8)
      .setAuthor({ name: "AiMate  /  LOG SETTINGS" })
      .setTitle(
        enabled ? "✓  로그 채널을 연결했어요" : "⊘  로그 수신을 해제했어요",
      )
      .setDescription(
        `<#${channel.id}>에서 생성 로그 수신을 **${enabled ? "활성화" : "비활성화"}**했어요.`,
      )
      .setFooter({
        text: "대기 중인 메시지부터 응답 완료까지 같은 로그 카드에서 갱신돼요.",
      });
    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  },
};
