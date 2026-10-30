import { ParticipantResolver } from "./ParticipantResolver.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("ParticipantService");

export class ParticipantService {
  /**
   * @param {Map<string, {
   *   getProfiles(channel: Object, ids: string[]): Promise<Array>,
   *   listMembers(channel: Object, options: Object): Promise<{profiles: Array, source: string}>,
   *   getStatus(channel: Object, id: string): Promise<Object|null>
   * }>} sources Platform adapters returning plain profiles, never platform objects.
   */
  constructor(sources = new Map()) {
    this.sources = sources;
  }

  async prepare(channel, messages) {
    const profiles = new Map();
    for (const message of messages) {
      if (message.authorPlatformId)
        profiles.set(message.authorPlatformId, {
          id: message.authorPlatformId,
          handle: message.authorHandle,
          displayName: message.authorDisplayName,
        });
      for (const [, id] of String(message.content ?? "").matchAll(
        /<@!?(\d+)>/g,
      ))
        if (!profiles.has(id)) profiles.set(id, { id });
    }
    try {
      const source = this.sources.get(channel?.platform);
      for (const profile of (await source?.getProfiles(channel, [
        ...profiles.keys(),
      ])) ?? [])
        profiles.set(profile.id, { ...profiles.get(profile.id), ...profile });
    } catch (err) {
      logger.warn(
        { event: "participants.lookup.failed", err },
        "Using observed participant identities",
      );
    }
    return new ParticipantResolver([...profiles.values()]);
  }

  async listMembers({ query = "", limit = 20 }, context) {
    context.abortSignal?.throwIfAborted();
    const source = this.sources.get(context.channel?.platform);
    if (!source) return { error: "unavailable" };
    const result = await source.listMembers(context.channel, { query, limit });
    context.abortSignal?.throwIfAborted();
    const resolver = context.participantResolver ?? new ParticipantResolver();
    resolver.remember(result.profiles);
    return {
      members: result.profiles.map((profile) =>
        publicProfile({
          ...resolver.get(profile.id),
          status: profile.status,
          activities: profile.activities,
        }),
      ),
      complete: false,
      source: result.source,
    };
  }

  async getStatus({ user }, context) {
    context.abortSignal?.throwIfAborted();
    const source = this.sources.get(context.channel?.platform);
    if (!source) return { error: "unavailable" };
    const resolver = context.participantResolver ?? new ParticipantResolver();
    let resolved = resolver.resolve(user);
    if (!resolved || resolved.error === "not_found") {
      const { profiles } = await source.listMembers(context.channel, {
        query: user,
        limit: 50,
      });
      resolver.remember(profiles);
      resolved = resolver.resolve(user);
    }
    context.abortSignal?.throwIfAborted();
    if (resolved.error) return resolved;
    const current = await source.getStatus(
      context.channel,
      resolved.profile.id,
    );
    context.abortSignal?.throwIfAborted();
    if (!current) return { error: "unavailable" };
    // Preserve the identity the model saw even if a nickname changes during a turn.
    return publicProfile({
      ...resolved.profile,
      status: current.status,
      activities: current.activities,
    });
  }
}

function publicProfile(profile) {
  const sanitized = new ParticipantResolver([profile]).get(profile.id);
  return {
    name: profile.label ?? sanitized.label,
    username: sanitized.handle,
    tag: sanitized.tag || null,
    status: ["online", "idle", "dnd", "offline"].includes(profile.status)
      ? profile.status
      : "unknown",
    activities: sanitized.activities,
  };
}
