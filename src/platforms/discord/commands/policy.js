import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import {
  PolicySettingsError,
  policyChannelTypes,
  policyDurations,
} from "../policy/DiscordPolicyService.js";
import {
  effectivePolicy,
  PolicyEffect,
  PolicyType,
} from "../../../policies/Policy.js";

const types = [{ name: "대화", value: PolicyType.CONVERSATION }];
const scopes = [
  { name: "서버", value: "server" },
  { name: "카테고리", value: "category" },
  { name: "채널", value: "channel" },
];
const withTarget = (command) =>
  command
    .addStringOption((option) =>
      option
        .setName("유형")
        .setDescription("정책을 적용할 기능")
        .setRequired(true)
        .addChoices(...types),
    )
    .addStringOption((option) =>
      option
        .setName("범위")
        .setDescription("설정 범위 (기본: 채널)")
        .addChoices(...scopes),
    )
    .addChannelOption((option) =>
      option
        .setName("대상")
        .setDescription(
          "대상 채널·카테고리 (생략: 현재 위치, 스레드는 부모 채널)",
        )
        .addChannelTypes(...policyChannelTypes, ChannelType.GuildCategory),
    );
const label = (allowed) => (allowed ? "허용" : "거부");
const targetLabel = (scope, id) =>
  scope === "server" ? "이 서버" : `<#${id}>`;
const sourceLabel = (source) =>
  source
    ? `${targetLabel(source.scope, source.targetId)} · ${source.temporary ? "임시 설정" : "기본 설정"}`
    : "기본값 · 거부";
const timestamp = (date) =>
  `<t:${Math.floor(date.getTime() / 1000)}:f> (<t:${Math.floor(date.getTime() / 1000)}:R>)`;

function settingsFile(policies, now) {
  const rows = policies.map((rule) => {
    const temporary = rule.temporaryEffect !== null && rule.expiresAt > now;
    return [
      `유형: ${rule.type}`,
      `${scopes.find((item) => item.value === rule.scope).name}: ${rule.targetId}`,
      `기본: ${rule.effect === null ? "상속" : label(rule.effect === PolicyEffect.ALLOW)}`,
      ...(temporary
        ? [
            `임시: ${label(rule.temporaryEffect === PolicyEffect.ALLOW)}, 만료: ${rule.expiresAt.toISOString()}`,
          ]
        : []),
      `변경자: ${rule.updatedBy}, 변경 시각: ${rule.updatedAt.toISOString()}`,
    ].join(" | ");
  });
  return new AttachmentBuilder(Buffer.from(rows.join("\n"), "utf8"), {
    name: "policy-settings.txt",
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName("정책")
    .setDescription("AiMate의 기능별 허용·거부 정책을 관리합니다.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((command) =>
      withTarget(
        command
          .setName("설정")
          .setDescription(
            "선택한 기능을 허용·거부하거나 상위 정책을 상속합니다.",
          )
          .addStringOption((option) =>
            option
              .setName("상태")
              .setDescription("적용할 상태")
              .setRequired(true)
              .addChoices(
                { name: "허용", value: "allow" },
                { name: "거부", value: "deny" },
                { name: "상속", value: "inherit" },
              ),
          ),
      ).addIntegerOption((option) =>
        option
          .setName("기간")
          .setDescription("임시 적용 기간 (생략: 무기한, 상속에는 지정 불가)")
          .addChoices(...policyDurations),
      ),
    )
    .addSubcommand((command) =>
      withTarget(
        command
          .setName("상태")
          .setDescription(
            "현재 적용 상태·근거·만료와 서버의 개별 설정을 확인합니다.",
          ),
      ),
    ),

  async execute(interaction, { discordPolicyService: service }) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (
      !interaction.guildId ||
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.editReply({
        content: "서버 관리 권한이 있어야 정책을 조회·변경할 수 있어요.",
      });
    }
    const type = interaction.options.getString("유형", true);
    const scope = interaction.options.getString("범위") ?? "channel";
    const channel =
      interaction.options.getChannel("대상") ??
      (scope === "server" ? null : interaction.channel);
    const changing = interaction.options.getSubcommand() === "설정";
    const state = changing ? interaction.options.getString("상태", true) : null;
    const request = { guildId: interaction.guildId, type, scope, channel };
    try {
      if (
        changing &&
        type === PolicyType.CONVERSATION &&
        state === "allow" &&
        scope === "channel"
      ) {
        const target = await service.target(request);
        const parent = await service.channel(target.channelId);
        if (!parent)
          throw new PolicySettingsError("대상 채널을 조회할 수 없어요.");
        const permission = [
          ChannelType.GuildForum,
          ChannelType.GuildMedia,
        ].includes(parent.type)
          ? PermissionFlagsBits.SendMessagesInThreads
          : PermissionFlagsBits.SendMessages;
        if (
          !parent
            .permissionsFor(interaction.client.user)
            ?.has([PermissionFlagsBits.ViewChannel, permission])
        ) {
          throw new PolicySettingsError(
            "대상 채널에서 봇에게 채널 보기·메시지 보내기 권한이 필요해요.",
          );
        }
      }
      const result = changing
        ? await service.configure({
            ...request,
            state,
            hours: interaction.options.getInteger("기간"),
            updatedBy: interaction.user.id,
          })
        : await service.status(request);
      const embed = new EmbedBuilder()
        .setColor(result.allowed ? 0x34d399 : 0x94a3b8)
        .setTitle(changing ? "정책을 변경했어요" : "정책 상태")
        .setDescription(
          `${types.find((item) => item.value === result.type).name} · ${targetLabel(scope, result.targetId)} · **${label(result.allowed)}**`,
        )
        .addFields({
          name: "적용 근거",
          value: result.logChannel
            ? "로그 전용 채널 · 대화 제외"
            : sourceLabel(result.source),
        });
      if (changing) {
        embed.addFields({
          name: "변경 내용",
          value:
            state === "inherit"
              ? "이 범위의 기본·임시 설정을 지우고 상속해요."
              : `${label(state === "allow")} · ${interaction.options.getInteger("기간") ? `${interaction.options.getInteger("기간")}시간 임시 적용` : "무기한"}`,
        });
      }
      if (result.expiresAt && !result.logChannel) {
        embed.addFields(
          { name: "다음 만료", value: timestamp(result.expiresAt) },
          {
            name: "만료 후",
            value: `${label(result.afterExpiry.allowed)} · ${sourceLabel(result.afterExpiry.source)}`,
          },
        );
      }
      const files = [];
      if (scope === "server") {
        const individual = result.policies.filter(
          (rule) => rule.scope !== "server",
        );
        const overview = individual.slice(0, 8).map((rule) => {
          const effective = effectivePolicy(rule, result.evaluatedAt);
          return `${targetLabel(rule.scope, rule.targetId)} · ${label(effective.effect === PolicyEffect.ALLOW)}${effective.temporary ? " · 임시" : ""}`;
        });
        embed.addFields({
          name: `개별 설정 (${individual.length}개)`,
          value:
            overview.join("\n") || "없음 · 모든 채널이 서버 설정을 상속해요.",
        });
        if (result.policies.length)
          files.push(settingsFile(result.policies, result.evaluatedAt));
        embed.setFooter({
          text: "개별 채널·카테고리 설정은 유지돼요. 로그 전용 채널은 대화에서 제외돼요.",
        });
      } else {
        embed.setFooter({
          text: "채널 → 카테고리 → 서버 → 기본 비활성화 순으로 적용돼요. 스레드는 부모 채널을 따라요.",
        });
      }
      return interaction.editReply({
        embeds: [embed],
        files,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      if (!(error instanceof PolicySettingsError)) throw error;
      return interaction.editReply({ content: error.message });
    }
  },
};
