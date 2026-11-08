import { prisma } from "../database/client.js";
import { PolicyEffect } from "../policies/Policy.js";

function subject({ platform, type, scope, targetId }) {
  if (
    [platform, type, scope, targetId].some(
      (value) => typeof value !== "string" || !value,
    )
  ) {
    throw new Error("Policy requires platform, type, scope and targetId.");
  }
  return { platform, type, scope, targetId };
}

/** Scoped permissions and temporary overrides, independent of platform SDKs and action types. */
export class PolicyRepository {
  constructor(characterId) {
    if (!characterId) throw new Error("Policy requires characterId.");
    this.characterId = characterId;
  }
  async list({ platform, platformServerId = null, type }) {
    if ([platform, type].some((value) => typeof value !== "string" || !value)) {
      throw new Error("Platform and policy type are required.");
    }
    return prisma.policy.findMany({
      where: {
        characterId: this.characterId,
        platform,
        platformServerId,
        type,
      },
      orderBy: [{ scope: "asc" }, { targetId: "asc" }],
    });
  }

  async set({
    platformServerId = null,
    effect,
    expiresAt = null,
    updatedBy,
    ...target
  }) {
    const identity = { characterId: this.characterId, ...subject(target) };
    if (!Object.values(PolicyEffect).includes(effect))
      throw new Error("Policy effect must be allow or deny.");
    const settings = expiresAt
      ? { temporaryEffect: effect, expiresAt }
      : { effect, temporaryEffect: null, expiresAt: null };
    await prisma.policy.upsert({
      where: { characterId_platform_type_scope_targetId: identity },
      update: { platformServerId, ...settings, updatedBy },
      create: { ...identity, platformServerId, ...settings, updatedBy },
    });
  }

  async remove(target) {
    await prisma.policy.deleteMany({
      where: { characterId: this.characterId, ...subject(target) },
    });
  }
}
