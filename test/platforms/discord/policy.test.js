import test from "node:test";
import assert from "node:assert/strict";
import {
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  InteractionContextType,
} from "discord.js";
import command from "../../../src/platforms/discord/commands/policy.js";
import { DiscordPolicyService } from "../../../src/platforms/discord/policy/DiscordPolicyService.js";

const policy = (scope, targetId, enabled, extra = {}) => ({
  platform: "discord",
  platformServerId: "guild",
  type: "conversation",
  scope,
  targetId,
  effect: enabled === null ? null : enabled ? "allow" : "deny",
  temporaryEffect: null,
  expiresAt: null,
  updatedBy: "admin",
  updatedAt: new Date("2026-11-02T00:00:00Z"),
  ...extra,
});
function harness() {
  let now = new Date("2026-11-02T00:00:00Z");
  const channels = new Map([
    [
      "text",
      {
        id: "text",
        guildId: "guild",
        type: ChannelType.GuildText,
        parentId: "category",
        permissionsFor: () => ({ has: () => true }),
      },
    ],
    [
      "category",
      { id: "category", guildId: "guild", type: ChannelType.GuildCategory },
    ],
    [
      "thread",
      {
        id: "thread",
        guildId: "guild",
        parentId: "text",
        isThread: () => true,
      },
    ],
    [
      "forum",
      {
        id: "forum",
        guildId: "guild",
        type: ChannelType.GuildForum,
        parentId: "category",
      },
    ],
    [
      "post",
      { id: "post", guildId: "guild", parentId: "forum", isThread: () => true },
    ],
  ]);
  const policies = [];
  const changes = [];
  const logs = new Set();
  const service = new DiscordPolicyService({
    client: {
      channels: {
        cache: channels,
        fetch: async (id) => channels.get(id) ?? null,
      },
    },
    repository: {
      list: async (context) => {
        assert.deepEqual(context, {
          platform: "discord",
          platformServerId: "guild",
          type: "conversation",
        });
        return policies;
      },
      set: async (request) => {
        changes.push(request);
      },
      remove: async (request) => {
        changes.push(request);
      },
    },
    channelRepository: {
      findByPlatformId: async (_platform, id) => ({ logEnabled: logs.has(id) }),
    },
    now: () => now,
  });
  return {
    service,
    policies,
    changes,
    channels,
    logs,
    setTime: (value) => {
      now = new Date(value);
    },
    enabled: (id = "text") =>
      service.isAllowed(
        { platform: "discord", platformChannelId: id },
        "conversation",
      ),
  };
}

test("conversation policy defaults off, inherits by hierarchy and follows new channels, moves and threads", async () => {
  const h = harness();
  assert.equal(await h.enabled(), false);
  assert.equal(await h.enabled("thread"), false);
  h.policies.push(policy("server", "guild", true));
  assert.equal(await h.enabled(), true);
  h.channels.set("new", {
    id: "new",
    guildId: "guild",
    type: ChannelType.GuildText,
    parentId: "category",
  });
  assert.equal(await h.enabled("new"), true);
  h.policies.push(policy("category", "category", false));
  assert.equal(await h.enabled("new"), false);
  assert.equal(await h.enabled("post"), false);
  h.policies.push(policy("channel", "text", true));
  assert.equal(await h.enabled("thread"), true);
  h.policies[0].effect = "deny";
  assert.equal(
    await h.enabled(),
    true,
    "A server setting preserves explicit channel exceptions",
  );
  h.policies.pop();
  assert.equal(
    await h.enabled(),
    false,
    "Removing a local policy restores inheritance",
  );
  h.policies[0].effect = "allow";
  h.channels.get("text").parentId = "other-category";
  assert.equal(
    await h.enabled("thread"),
    true,
    "A moved parent's current category applies",
  );
});

test("temporary settings expire at the exact deadline and resolve current parents without a timer", async () => {
  const h = harness();
  h.policies.push(
    policy("server", "guild", true),
    policy("channel", "text", null, {
      temporaryEffect: "deny",
      expiresAt: new Date("2026-11-02T01:00:00Z"),
    }),
  );
  assert.equal(await h.enabled(), false);
  const status = await h.service.status({
    guildId: "guild",
    type: "conversation",
    scope: "channel",
    channel: h.channels.get("text"),
  });
  assert.equal(status.source.temporary, true);
  assert.equal(status.afterExpiry.allowed, true);
  h.policies[0].effect = "deny";
  h.setTime("2026-11-02T01:00:00Z");
  const restarted = new DiscordPolicyService({
    client: h.service.client,
    repository: h.service.repository,
    channelRepository: h.service.channelRepository,
    now: h.service.now,
  });
  assert.equal(
    await restarted.isAllowed(
      {
        platform: "discord",
        platformChannelId: "text",
      },
      "conversation",
    ),
    false,
  );
  h.policies[0].effect = "allow";
  assert.equal(await h.enabled(), true);
  const after = await h.service.status({
    guildId: "guild",
    type: "conversation",
    scope: "server",
    channel: null,
  });
  assert.equal(
    after.policies.length,
    1,
    "Expired temporary-only records are not active settings",
  );
  h.policies[1].effect = "deny";
  assert.equal(
    await h.enabled(),
    false,
    "A local permanent base survives its temporary override",
  );
});

test("settings validate scope, targets, periods and log channels before writing", async () => {
  const h = harness();
  const request = {
    guildId: "guild",
    type: "conversation",
    scope: "channel",
    channel: h.channels.get("text"),
    state: "allow",
    updatedBy: "admin",
  };
  for (const change of [
    { hours: 2 },
    { hours: 1, state: "inherit" },
    { scope: "global" },
    { channel: { ...request.channel, guildId: "other" } },
    { scope: "server" },
    { scope: "category", channel: { ...request.channel, parentId: null } },
    { channel: h.channels.get("category") },
  ])
    await assert.rejects(h.service.configure({ ...request, ...change }));
  h.logs.add("text");
  await assert.rejects(h.service.configure(request), /로그 전용/);
  assert.equal(h.changes.length, 0);
  let reconciled = 0;
  h.service.reconcile = async () => reconciled++;
  await h.service.configure({ ...request, state: "deny", hours: 3 });
  assert.equal(
    h.changes[0].expiresAt.toISOString(),
    "2026-11-02T03:00:00.000Z",
  );
  assert.equal(reconciled, 1);
  h.policies.push(policy("server", "guild", true));
  assert.equal(
    await h.enabled("thread"),
    false,
    "Log channels and their threads are always excluded",
  );
  await h.service.configure({
    ...request,
    state: "inherit",
    channel: h.channels.get("thread"),
  });
  assert.equal(h.changes[1].targetId, "text");
});

test("DMs and unavailable channels stay off; transient lookup errors remain visible", async () => {
  const h = harness();
  assert.equal(
    await h.service.isAllowed(
      { platform: "discord", platformChannelId: "text" },
      "profile.view",
    ),
    false,
  );
  await assert.rejects(
    h.service.configure({
      guildId: "guild",
      type: "profile.view",
      scope: "server",
      channel: null,
      state: "allow",
      updatedBy: "admin",
    }),
    /지원하지 않는 정책/,
  );
  h.channels.set("dm", { id: "dm" });
  assert.equal(await h.enabled("dm"), false);
  assert.equal(await h.enabled("deleted"), false);
  h.service.client.channels.fetch = async () => {
    throw Object.assign(new Error("denied"), { code: 50001 });
  };
  assert.equal(await h.enabled("private"), false);
  h.service.client.channels.fetch = async () => {
    throw new Error("network unavailable");
  };
  await assert.rejects(h.enabled("private"), /network/);
});

function interaction(h, values = {}) {
  const replies = [];
  const deferred = [];
  return {
    guildId: "guild",
    channel: h.channels.get("text"),
    client: { user: { id: "bot" } },
    user: { id: "admin" },
    memberPermissions: {
      has: (permission) => permission === PermissionFlagsBits.ManageGuild,
    },
    options: {
      getSubcommand: () => values.subcommand ?? "설정",
      getString: (key) =>
        values[key] ??
        (key === "상태" ? "allow" : key === "유형" ? "conversation" : null),
      getChannel: () => values.channel ?? null,
      getInteger: () => values.hours ?? null,
    },
    deferReply: async (value) => {
      deferred.push(value);
    },
    editReply: async (value) => {
      replies.push(value);
    },
    replies,
    deferred,
  };
}

test("unified command schema is guild-only and applies ephemeral, permission-checked changes", async () => {
  const schema = command.data.toJSON();
  assert.deepEqual(schema.contexts, [InteractionContextType.Guild]);
  assert.equal(schema.name, "정책");
  for (const subcommand of schema.options) {
    const type = subcommand.options.find((option) => option.name === "유형");
    assert.equal(type.required, true);
    assert.deepEqual(
      type.choices.map(({ name, value }) => ({ name, value })),
      [{ name: "대화", value: "conversation" }],
    );
  }
  assert.equal(
    schema.default_member_permissions,
    PermissionFlagsBits.ManageGuild.toString(),
  );
  assert.deepEqual(
    schema.options.map((option) => option.name),
    ["설정", "상태"],
  );
  const h = harness();
  const i = interaction(h, { hours: 1 });
  await command.execute(i, { discordPolicyService: h.service });
  assert.deepEqual(i.deferred, [{ flags: MessageFlags.Ephemeral }]);
  assert.equal(h.changes[0].scope, "channel");
  assert.equal(h.changes[0].updatedBy, "admin");
  assert.equal(
    h.changes[0].expiresAt.toISOString(),
    "2026-11-02T01:00:00.000Z",
  );
  assert.deepEqual(i.replies[0].allowedMentions, { parse: [] });
  const unauthorized = interaction(h);
  unauthorized.memberPermissions = null;
  await command.execute(unauthorized, {
    discordPolicyService: h.service,
  });
  assert.match(unauthorized.replies[0].content, /서버 관리 권한/);
  const dm = interaction(h);
  dm.guildId = null;
  await command.execute(dm, { discordPolicyService: h.service });
  assert.match(dm.replies[0].content, /서버 관리 권한/);
  assert.equal(h.changes.length, 1);
});

test("status includes reason, next expiry, exceptions and a complete file; invalid changes stay private", async () => {
  const h = harness();
  h.policies.push(
    policy("server", "guild", true, {
      temporaryEffect: "deny",
      expiresAt: new Date("2026-11-02T01:00:00Z"),
    }),
  );
  for (let index = 0; index < 15; index++)
    h.policies.push(policy("channel", `text-${index}`, true));
  const i = interaction(h, { subcommand: "상태", 범위: "server" });
  await command.execute(i, { discordPolicyService: h.service });
  const result = i.replies[0];
  const embed = result.embeds[0].toJSON();
  assert.match(embed.description, /거부/);
  assert.match(
    embed.fields.find((field) => field.name === "적용 근거").value,
    /임시/,
  );
  assert.match(
    embed.fields.find((field) => field.name === "만료 후").value,
    /허용/,
  );
  assert.match(
    embed.fields.find((field) => field.name.startsWith("개별 설정")).name,
    /15/,
  );
  assert.match(result.files[0].attachment.toString("utf8"), /text-14/);
  const invalid = interaction(h, { 상태: "inherit", hours: 1 });
  await command.execute(invalid, { discordPolicyService: h.service });
  assert.match(invalid.replies[0].content, /기간/);
  h.channels.get("text").permissionsFor = () => ({ has: () => false });
  const denied = interaction(h);
  await command.execute(denied, { discordPolicyService: h.service });
  assert.match(denied.replies[0].content, /봇에게/);
  const disable = interaction(h, { 상태: "deny" });
  await command.execute(disable, { discordPolicyService: h.service });
  assert.equal(
    h.changes[0].effect,
    "deny",
    "Disabling remains possible after bot permission loss",
  );
});
