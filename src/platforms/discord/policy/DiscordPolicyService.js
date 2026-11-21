import { ChannelType } from "discord.js";
import { createLogger } from "../../../core/logger.js";
import {
  effectivePolicy,
  resolvePolicy,
  PolicyType,
} from "../../../policies/Policy.js";

const logger = createLogger("Discord:Policy");
export class PolicySettingsError extends Error {}
export const policyChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
];
export const policyDurations = [1, 3, 6, 12, 24].map((hours) => ({
  name: hours === 24 ? "1일" : `${hours}시간`,
  value: hours,
}));

/** Resolves Discord hierarchy at use time; expiration never depends on a timer firing. */
export class DiscordPolicyService {
  constructor({
    client,
    repository,
    channelRepository,
    allowDirectMessages = false,
    now = () => new Date(),
  }) {
    Object.assign(this, {
      client,
      repository,
      channelRepository,
      allowDirectMessages,
      now,
    });
  }

  start(reconcile) {
    if (this.timer) return;
    this.reconcile = reconcile;
    // Only live conversations are inspected. Persisted deadlines also work after restart.
    this.timer = setInterval(() => {
      this.refreshing ??= reconcile()
        .catch((err) =>
          logger.error(
            { event: "conversation.reconcile.failed", err },
            "Conversation reconciliation failed",
          ),
        )
        .finally(() => {
          this.refreshing = null;
        });
    }, 1000);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async close() {
    this.stop();
    await this.refreshing;
  }

  async channel(id) {
    try {
      return (
        this.client.channels.cache?.get(id) ??
        (await this.client.channels.fetch(id))
      );
    } catch (error) {
      if ([10003, 50001, 50013].includes(error.code)) return null;
      throw error;
    }
  }

  async location(channel) {
    if (!channel?.guildId) return null;
    const parent = channel.isThread?.()
      ? await this.channel(channel.parentId)
      : channel;
    if (!parent || !policyChannelTypes.includes(parent.type)) return null;
    return {
      guildId: channel.guildId,
      channelId: parent.id,
      categoryId: parent.parentId ?? null,
    };
  }

  chain({ guildId, channelId, categoryId }, scope = "channel") {
    return [
      ...(scope === "channel"
        ? [{ scope: "channel", targetId: channelId }]
        : []),
      ...(scope !== "server" && categoryId
        ? [{ scope: "category", targetId: categoryId }]
        : []),
      { scope: "server", targetId: guildId },
    ];
  }

  async isAllowed(channelPort, type) {
    if (
      channelPort.platform !== "discord" ||
      !Object.values(PolicyType).includes(type)
    )
      return false;
    const channel = await this.channel(channelPort.platformChannelId);
    if (channel?.type === ChannelType.DM)
      return (
        type === PolicyType.CONVERSATION &&
        this.allowDirectMessages &&
        !(await this.isLogChannel(channel.id))
      );
    const location = await this.location(channel);
    if (
      !location ||
      (type === PolicyType.CONVERSATION &&
        (await this.isLogChannel(location.channelId)))
    )
      return false;
    const policies = await this.repository.list({
      platform: "discord",
      platformServerId: location.guildId,
      type,
    });
    return resolvePolicy({
      policies,
      type,
      chain: this.chain(location),
      now: this.now(),
    }).allowed;
  }

  async isLogChannel(channelId) {
    const channel = await this.channelRepository.findByPlatformId(
      "discord",
      channelId,
    );
    return channel?.logEnabled === true;
  }

  async target({ guildId, type, scope, channel }) {
    if (!Object.values(PolicyType).includes(type))
      throw new PolicySettingsError("지원하지 않는 정책 유형이에요.");
    if (!guildId || !["server", "category", "channel"].includes(scope)) {
      throw new PolicySettingsError("서버와 올바른 범위를 지정해 주세요.");
    }
    if (scope === "server") {
      if (channel)
        throw new PolicySettingsError(
          "서버 범위에서는 대상을 지정하지 않아요.",
        );
      return { guildId, channelId: null, categoryId: null, targetId: guildId };
    }
    if (!channel || channel.guildId !== guildId)
      throw new PolicySettingsError("이 서버의 대상을 선택해 주세요.");
    if (scope === "category" && channel.type === ChannelType.GuildCategory) {
      return {
        guildId,
        channelId: null,
        categoryId: channel.id,
        targetId: channel.id,
      };
    }
    const location = await this.location(channel);
    if (!location)
      throw new PolicySettingsError(
        "텍스트·공지·포럼·미디어 채널 또는 카테고리를 선택해 주세요.",
      );
    const targetId =
      scope === "category" ? location.categoryId : location.channelId;
    if (!targetId)
      throw new PolicySettingsError(
        "현재 채널에 카테고리가 없어요. 대상을 지정해 주세요.",
      );
    return { ...location, targetId };
  }

  async configure({ guildId, type, scope, channel, state, hours, updatedBy }) {
    if (
      !["server", "category", "channel"].includes(scope) ||
      !["allow", "deny", "inherit"].includes(state)
    ) {
      throw new PolicySettingsError("올바른 범위와 상태를 선택해 주세요.");
    }
    if (
      hours != null &&
      (!policyDurations.some((item) => item.value === hours) ||
        state === "inherit")
    ) {
      throw new PolicySettingsError(
        "기간은 허용·거부에만 1·3·6·12·24시간으로 지정할 수 있어요.",
      );
    }
    const target = await this.target({ guildId, type, scope, channel });
    if (
      scope === "channel" &&
      type === PolicyType.CONVERSATION &&
      state === "allow" &&
      (await this.isLogChannel(target.channelId))
    ) {
      throw new PolicySettingsError(
        "로그 전용 채널에서는 대화를 활성화할 수 없어요.",
      );
    }
    const subject = {
      platform: "discord",
      type,
      scope,
      targetId: target.targetId,
    };
    if (state === "inherit") {
      await this.repository.remove(subject);
    } else {
      await this.repository.set({
        ...subject,
        platformServerId: guildId,
        effect: state,
        updatedBy,
        expiresAt:
          hours == null
            ? null
            : new Date(this.now().getTime() + hours * 3_600_000),
      });
    }
    await this.reconcile?.();
    return this.status({ guildId, type, scope, channel });
  }

  async status({ guildId, type, scope, channel }) {
    const target = await this.target({ guildId, type, scope, channel });
    const policies = await this.repository.list({
      platform: "discord",
      platformServerId: guildId,
      type,
    });
    const chain = this.chain(target, scope);
    const now = this.now();
    const status = resolvePolicy({ policies, type, chain, now });
    const deadlines = policies.filter(
      (row) =>
        row.expiresAt > now &&
        chain.some(
          (item) => item.scope === row.scope && item.targetId === row.targetId,
        ),
    );
    const expiresAt = deadlines.length
      ? new Date(Math.min(...deadlines.map((row) => row.expiresAt.getTime())))
      : null;
    const logChannel =
      type === PolicyType.CONVERSATION &&
      scope === "channel" &&
      (await this.isLogChannel(target.channelId));
    const afterExpiry = expiresAt
      ? resolvePolicy({ policies, type, chain, now: expiresAt })
      : null;
    return {
      ...target,
      scope,
      type,
      evaluatedAt: now,
      ...status,
      allowed: !logChannel && status.allowed,
      logChannel,
      expiresAt,
      afterExpiry,
      policies: policies.filter((row) => effectivePolicy(row, now)),
    };
  }
}
