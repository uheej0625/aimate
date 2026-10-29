import test from "node:test";
import assert from "node:assert/strict";
import { Client, ClientUser, GatewayOpcodes } from "discord.js";
import statusTool from "../../src/tools/definitions/setDiscordStatus.js";
import activityTool from "../../src/tools/definitions/setDiscordActivity.js";
import { ToolRegistry } from "../../src/tools/ToolRegistry.js";

function fixture() {
  const client = new Client({ intents: [] });
  client.user = new ClientUser(client, { id: "123", username: "bot" });
  const packets = [];
  client.ws.broadcast = (packet) => packets.push(packet);
  const registry = new ToolRegistry({ get: () => undefined });
  registry.registerAll([statusTool, activityTool]);
  return {
    client,
    packets,
    tools: registry.createToolSet("discord", { platformClient: client }),
  };
}

test("status updates preserve activities through discord.js", async () => {
  const { packets, tools } = fixture();
  await tools.set_discord_activity.execute({
    activities: [
      { type: "PLAYING", name: "The Legend of Zelda: Tears of the Kingdom" },
    ],
  });
  const activities = structuredClone(packets.at(-1).d.activities);
  for (const status of ["online", "idle", "dnd", "invisible", "offline"]) {
    assert.deepEqual(await tools.set_discord_status.execute({ status }), {
      success: true,
      status,
    });
    assert.equal(packets.at(-1).op, GatewayOpcodes.PresenceUpdate);
    assert.equal(packets.at(-1).d.status, status);
    assert.deepEqual(packets.at(-1).d.activities, activities);
  }
});

test("activity updates preserve status and normalize custom text", async () => {
  const { packets, tools } = fixture();
  await tools.set_discord_status.execute({ status: "dnd" });
  const types = ["PLAYING", "LISTENING", "WATCHING", "CUSTOM", "COMPETING"];
  const ids = [0, 2, 3, 4, 5];
  for (const [index, type] of types.entries()) {
    const name = type === "CUSTOM" ? "잠깐 쉬는 중" : "Stardew Valley";
    const input = { activities: [{ type, name }] };
    assert.deepEqual(await tools.set_discord_activity.execute(input), {
      success: true,
      ...input,
    });
    assert.deepEqual(input.activities, [{ type, name }]);
    assert.deepEqual(packets.at(-1), {
      op: GatewayOpcodes.PresenceUpdate,
      d: {
        status: "dnd",
        afk: false,
        since: null,
        activities: [
          {
            type: ids[index],
            name: type === "CUSTOM" ? "Custom Status" : name,
            state: type === "CUSTOM" ? name : undefined,
            url: undefined,
          },
        ],
      },
    });
  }
  assert.deepEqual(
    await tools.set_discord_activity.execute({ activities: [] }),
    {
      success: true,
      activities: [],
    },
  );
  assert.deepEqual(packets.at(-1).d, {
    status: "dnd",
    activities: [],
    afk: false,
    since: null,
  });
});

test("invalid status, streaming and unsupported fields never send a presence update", async () => {
  const { packets, tools } = fixture();
  for (const input of [
    null,
    {},
    { status: "busy" },
    { status: "idle", activities: [] },
  ]) {
    assert.equal(
      typeof (await tools.set_discord_status.execute(input)).error,
      "string",
    );
  }
  const activity = { type: "PLAYING", name: "Stardew Valley" };
  for (const input of [
    null,
    {},
    { activities: null },
    { activities: [], status: "idle" },
    ...[
      null,
      { ...activity, name: " " },
      { ...activity, type: "INVALID" },
      { ...activity, type: ["PLAYING"] },
      { ...activity, type: "STREAMING" },
      { ...activity, url: "https://twitch.tv/example" },
      { ...activity, state: "작업 중" },
      { ...activity, emoji: "😴" },
    ].map((invalid) => ({ activities: [activity, invalid] })),
  ]) {
    assert.equal(
      typeof (await tools.set_discord_activity.execute(input)).error,
      "string",
    );
  }
  assert.deepEqual(packets, []);
});

test("both presence tools report missing clients and SDK failures", async () => {
  const registry = new ToolRegistry({ get: () => undefined });
  registry.registerAll([statusTool, activityTool]);
  const tools = registry.createToolSet("discord", {
    platformClient: {
      user: {
        setPresence() {
          throw new Error("gateway failed");
        },
        setStatus() {
          throw new Error("gateway failed");
        },
      },
    },
  });
  for (const [definition, input] of [
    [statusTool, { status: "online" }],
    [activityTool, { activities: [] }],
  ]) {
    assert.match((await definition.execute(input, {})).error, /클라이언트/);
    assert.deepEqual(await tools[definition.name].execute(input), {
      error: "gateway failed",
    });
  }
});

test("directory loading exposes separate status and activity tools only on Discord", async () => {
  const registry = new ToolRegistry({ get: () => undefined });
  await registry.loadFromDirectory();
  const discord = registry.createToolSet("discord", {});
  const cli = registry.createToolSet("cli", {});
  assert.ok(discord.set_discord_status);
  assert.ok(discord.set_discord_activity);
  assert.equal(cli.set_discord_status, undefined);
  assert.equal(cli.set_discord_activity, undefined);
  assert.equal(discord.set_discord_presence, undefined);
});
