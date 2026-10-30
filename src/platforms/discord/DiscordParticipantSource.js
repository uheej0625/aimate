import { PermissionFlagsBits, ActivityType, ChannelType } from "discord.js";

/** Discord objects stop here; application services receive only plain data. */
export class DiscordParticipantSource {
  constructor(client) {
    this.client = client;
  }

  channel(record) {
    return this.client.channels.cache?.get(record?.platformId);
  }

  visible(channel, member) {
    return (
      Boolean(
        channel.permissionsFor?.(member)?.has(PermissionFlagsBits.ViewChannel),
      ) &&
      (channel.type !== ChannelType.PrivateThread ||
        channel.members?.cache?.has(member.id) ||
        channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageThreads))
    );
  }

  async getProfiles(record, ids) {
    const channel = this.channel(record);
    return ids.flatMap((id) => {
      const member = channel?.guild?.members.cache.get(id);
      const user = member?.user ?? this.client.users.cache?.get(id);
      if (!user) return [];
      return [
        profile(user, member && this.visible(channel, member) ? member : null),
      ];
    });
  }

  async listMembers(record, { query = "", limit = 20 } = {}) {
    const channel = this.channel(record);
    if (!channel?.guild) return { profiles: [], source: "unavailable" };
    limit = Math.max(1, Math.min(50, Math.trunc(limit) || 20));
    const members = channel.guild.members;
    // No unbounded guild fetch: the tool performs one bounded REST page/search.
    const fetched = query.trim()
      ? await members.search({
          query: query.trim().replace(/^@/, "").slice(0, 80),
          limit: 50,
        })
      : await members.list({ limit: 50 });
    const candidates = new Map([...members.cache, ...fetched]);
    const needle = query.trim().replace(/^@/, "").toLocaleLowerCase();
    const profiles = [...candidates.values()]
      .filter((member) => this.visible(channel, member))
      .map((member) => profile(member.user, member))
      .filter(
        (p) =>
          !needle ||
          [p.handle, p.nickname, p.displayName].some((s) =>
            s?.toLocaleLowerCase().includes(needle),
          ),
      )
      .sort(
        (a, b) =>
          Number(isOnline(b.status)) - Number(isOnline(a.status)) ||
          a.handle.localeCompare(b.handle),
      )
      .slice(0, limit);
    return { profiles, source: "cache_and_bounded_rest" };
  }

  async getStatus(record, id) {
    const channel = this.channel(record);
    if (!channel?.guild) return null;
    const member = await channel.guild.members.fetch({ user: id, force: true });
    return this.visible(channel, member) ? profile(member.user, member) : null;
  }
}

function isOnline(status) {
  return ["online", "idle", "dnd"].includes(status);
}

function profile(user, member) {
  return {
    id: user.id,
    handle: user.username,
    displayName: user.globalName,
    nickname: member?.nickname ?? null,
    tag: user.primaryGuild?.identityEnabled ? user.primaryGuild.tag : null,
    status: member?.presence?.status ?? "unknown",
    activities: (member?.presence?.activities ?? [])
      .map((activity) =>
        activity.type === ActivityType.Custom
          ? activity.state
          : `${activity.name}${activity.state ? ` · ${activity.state}` : ""}`,
      )
      .filter(Boolean),
  };
}
