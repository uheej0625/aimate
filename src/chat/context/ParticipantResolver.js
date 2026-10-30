/** Untrusted profile text is data, never a message header or instruction. */
export function profileText(value, limit = 80) {
  return String(value ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/[\[\]<>#`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/** One turn's identity map, shared by history, mentions and read tools. */
export class ParticipantResolver {
  constructor(profiles = []) {
    this.profiles = new Map();
    for (const profile of profiles) {
      if (!profile.id) continue;
      const handle = profileText(profile.handle, 40);
      let name =
        profileText(profile.nickname) ||
        profileText(profile.displayName) ||
        handle;
      if (!name) name = "알 수 없는 사용자";
      if (/^(assistant|system|developer|user|tool)$/i.test(name))
        name = `사용자 ${name}`;
      this.profiles.set(profile.id, {
        ...profile,
        handle,
        name,
        tag: profileText(profile.tag, 12),
        activities: (profile.activities ?? [])
          .map((value) => profileText(value, 120))
          .filter(Boolean),
      });
    }
    const counts = new Map();
    for (const { name } of this.profiles.values())
      counts.set(name, (counts.get(name) ?? 0) + 1);
    let index = 0;
    for (const profile of this.profiles.values()) {
      profile.handle ||= `participant-${++index}`;
      profile.label =
        counts.get(profile.name) > 1
          ? `${profile.name} (@${profile.handle})`
          : profile.name;
    }
  }

  get(id) {
    return this.profiles.get(id);
  }

  /** Extend this turn's map without renaming identities already shown to the model. */
  remember(profiles) {
    const expanded = new ParticipantResolver([
      ...this.profiles.values(),
      ...profiles.filter((profile) => !this.profiles.has(profile.id)),
    ]);
    for (const [id, profile] of expanded.profiles)
      if (!this.profiles.has(id)) this.profiles.set(id, profile);
  }

  resolve(user) {
    const query = String(user ?? "")
      .trim()
      .replace(/^@/, "")
      .toLocaleLowerCase();
    if (!query) return { error: "not_found" };
    const profiles = [...this.profiles.values()];
    const matches = profiles.filter(
      (p) => p.handle.toLocaleLowerCase() === query,
    );
    const exact = matches.length
      ? matches
      : profiles.filter((p) =>
          [p.name, p.label, `${p.name} (@${p.handle})`].some(
            (value) => value.toLocaleLowerCase() === query,
          ),
        );
    const candidates = exact.length
      ? exact
      : profiles.filter((p) =>
          [p.name, p.handle].some((value) =>
            value.toLocaleLowerCase().includes(query),
          ),
        );
    if (candidates.length === 1) return { profile: candidates[0] };
    return candidates.length
      ? {
          error: "ambiguous",
          candidates: candidates.map((p) => `${p.name} (@${p.handle})`),
        }
      : { error: "not_found" };
  }

  replaceMentions(content) {
    return String(content ?? "").replace(
      /<@!?(\d+)>/g,
      (_match, id) => `@${this.get(id)?.label ?? "알 수 없는 사용자"}`,
    );
  }
}
