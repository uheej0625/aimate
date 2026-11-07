import test from "node:test";
import assert from "node:assert/strict";
import {
  effectivePolicy,
  resolvePolicy,
  PolicyType,
  PolicyEffect,
} from "../../src/policies/Policy.js";

const policy = (scope, targetId, effect, extra = {}) => ({
  type: PolicyType.CONVERSATION,
  scope,
  targetId,
  effect,
  temporaryEffect: null,
  expiresAt: null,
  ...extra,
});

test("policies follow supplied scope priority and default to deny", () => {
  const policies = [
    policy("workspace", "workspace", "allow"),
    policy("folder", "folder", "deny"),
    policy("room", "room", "allow"),
  ];
  const chain = [
    { scope: "room", targetId: "room" },
    { scope: "folder", targetId: "folder" },
    { scope: "workspace", targetId: "workspace" },
  ];
  const resolve = (selected) =>
    resolvePolicy({ policies, type: PolicyType.CONVERSATION, chain: selected });
  assert.equal(resolve(chain).allowed, true);
  assert.equal(resolve(chain.slice(1)).allowed, false);
  assert.equal(resolve(chain.slice(2)).allowed, true);
  assert.equal(resolve([...chain].reverse()).source.scope, "workspace");
  assert.deepEqual(
    resolvePolicy({ policies: [], type: PolicyType.CONVERSATION, chain }),
    { allowed: false, source: null },
  );
});

test("policy types never grant or inherit permissions from a different action type", () => {
  const policies = [
    policy("server", "server", "allow"),
    policy("server", "server", "deny", { type: "profile.view" }),
  ];
  const chain = [{ scope: "server", targetId: "server" }];
  assert.equal(
    resolvePolicy({ policies, type: PolicyType.CONVERSATION, chain }).allowed,
    true,
  );
  assert.equal(
    resolvePolicy({ policies, type: "profile.view", chain }).allowed,
    false,
  );
  assert.deepEqual(resolvePolicy({ policies, type: "channel.create", chain }), {
    allowed: false,
    source: null,
  });
});

test("temporary permissions preserve the base and expire at the exact deadline", () => {
  const expiresAt = new Date("2026-11-02T01:00:00Z");
  const temporary = policy("channel", "channel", PolicyEffect.ALLOW, {
    temporaryEffect: PolicyEffect.DENY,
    expiresAt,
  });
  const before = effectivePolicy(temporary, new Date(expiresAt.getTime() - 1));
  assert.equal(before.effect, "deny");
  assert.equal(before.temporary, true);
  const after = effectivePolicy(temporary, expiresAt);
  assert.equal(after.effect, "allow");
  assert.equal(after.temporary, false);
  assert.equal(temporary.effect, "allow");
  assert.equal(
    temporary.temporaryEffect,
    "deny",
    "Resolution must not mutate persisted settings",
  );
});

test("temporary-only serverless policies inherit and fall back to deny after expiry", () => {
  const expiresAt = new Date("2026-11-02T01:00:00Z");
  const policies = [
    policy("session", "local", null, { temporaryEffect: "allow", expiresAt }),
  ];
  const chain = [{ scope: "session", targetId: "local" }];
  assert.equal(
    resolvePolicy({
      policies,
      type: PolicyType.CONVERSATION,
      chain,
      now: new Date(expiresAt.getTime() - 1),
    }).allowed,
    true,
  );
  assert.equal(effectivePolicy(policies[0], expiresAt), null);
  assert.deepEqual(
    resolvePolicy({
      policies,
      type: PolicyType.CONVERSATION,
      chain,
      now: expiresAt,
    }),
    { allowed: false, source: null },
  );
  assert.deepEqual(
    resolvePolicy({ policies: [{ ...policies[0], type: undefined }], chain }),
    { allowed: false, source: null },
  );
});
