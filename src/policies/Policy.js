export const PolicyType = Object.freeze({ CONVERSATION: "conversation" });
export const PolicyEffect = Object.freeze({ ALLOW: "allow", DENY: "deny" });

export function effectivePolicy(policy, now) {
  if (policy.temporaryEffect !== null && policy.expiresAt > now) {
    return { ...policy, effect: policy.temporaryEffect, temporary: true };
  }
  return policy.effect === null ? null : { ...policy, temporary: false };
}

/** The adapter supplies descending scope priority; unspecified types/scopes default to deny. */
export function resolvePolicy({ policies, type, chain, now = new Date() }) {
  if (typeof type !== "string" || !type)
    return { allowed: false, source: null };
  for (const { scope, targetId } of chain) {
    const policy = policies.find(
      (row) =>
        row.type === type && row.scope === scope && row.targetId === targetId,
    );
    const effective = policy && effectivePolicy(policy, now);
    if (effective)
      return {
        allowed: effective.effect === PolicyEffect.ALLOW,
        source: effective,
      };
  }
  return { allowed: false, source: null };
}
