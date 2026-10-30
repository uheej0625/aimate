import test from "node:test";
import assert from "node:assert/strict";
import { ActivityType, ChannelType, PermissionFlagsBits } from "discord.js";
import { DiscordParticipantSource } from "../../../src/platforms/discord/DiscordParticipantSource.js";

function harness({ type = ChannelType.GuildText } = {}) {
  const member = (id, extra = {}) => ({
    id,
    user: { id, username: `user${id}`, globalName: `global${id}` },
    nickname: `nick${id}`,
    presence: null,
    ...extra,
  });
  const members = new Map([
    ["1", member("1")],
    [
      "2",
      member("2", {
        presence: {
          status: "online",
          activities: [
            { type: ActivityType.Playing, name: "Minecraft" },
            { type: ActivityType.Custom, state: "custom\nstatus" },
          ],
        },
      }),
    ],
    ["3", member("3", { hidden: true })],
  ]);
  let requests = [];
  const channel = {
    type,
    members: { cache: new Map([["1", members.get("1")]]) },
    permissionsFor: (m) => ({
      has: (flag) => flag === PermissionFlagsBits.ViewChannel && !m.hidden,
    }),
    guild: {
      members: {
        cache: members,
        list: async (options) => {
          requests.push(["list", options]);
          return members;
        },
        search: async (options) => {
          requests.push(["search", options]);
          return members;
        },
        fetch: async (options) => {
          requests.push(["fetch", options]);
          return members.get(options.user);
        },
      },
    },
  };
  const client = {
    channels: { cache: new Map([["channel", channel]]) },
    users: { cache: new Map([...members].map(([id, m]) => [id, m.user])) },
  };
  const source = new DiscordParticipantSource(client);
  return {
    source,
    channel,
    members,
    requests,
    record: { platformId: "channel" },
  };
}

test("context profiles use cache, current nicknames and enabled guild tags without REST", async () => {
  const h = harness();
  h.members.get("1").user.primaryGuild = { identityEnabled: true, tag: "TAG" };
  h.members.get("2").user.primaryGuild = {
    identityEnabled: false,
    tag: "HIDE",
  };
  const profiles = await h.source.getProfiles(h.record, [
    "1",
    "2",
    "3",
    "missing",
  ]);
  assert.equal(profiles[0].nickname, "nick1");
  assert.equal(profiles[0].status, "unknown");
  assert.equal(profiles[0].tag, "TAG");
  assert.equal(profiles[1].tag, null);
  assert.deepEqual(profiles[1].activities, ["Minecraft", "custom\nstatus"]);
  assert.equal(profiles[2].status, "unknown");
  assert.equal(profiles[2].nickname, null);
  assert.deepEqual(h.requests, []);
});

test("member tools perform bounded reads, prefer online and filter channel permissions", async () => {
  const h = harness();
  const result = await h.source.listMembers(h.record, { limit: 500 });
  assert.deepEqual(h.requests, [["list", { limit: 50 }]]);
  assert.deepEqual(
    result.profiles.map((p) => p.id),
    ["2", "1"],
  );
  const searched = await h.source.listMembers(h.record, {
    query: "@user1",
    limit: 1,
  });
  assert.deepEqual(h.requests.at(-1), [
    "search",
    { query: "user1", limit: 50 },
  ]);
  assert.deepEqual(
    searched.profiles.map((p) => p.id),
    ["1"],
  );
  assert.equal(await h.source.getStatus(h.record, "3"), null);
  assert.deepEqual(h.requests.at(-1), ["fetch", { user: "3", force: true }]);
  assert.equal((await h.source.getStatus(h.record, "2")).status, "online");
});

test("private threads exclude nonmembers and DMs never invent guild presence", async () => {
  const h = harness({ type: ChannelType.PrivateThread });
  assert.deepEqual(
    (await h.source.listMembers(h.record)).profiles.map((p) => p.id),
    ["1"],
  );
  h.channel.guild = null;
  const dm = await h.source.getProfiles(h.record, ["2"]);
  assert.equal(dm[0].status, "unknown");
  assert.deepEqual(dm[0].activities, []);
  assert.equal(await h.source.getStatus(h.record, "2"), null);
  assert.deepEqual(await h.source.listMembers(h.record), {
    profiles: [],
    source: "unavailable",
  });
});
