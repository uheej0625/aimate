import test from "node:test";
import assert from "node:assert/strict";
import { createDiscordClient } from "../../../src/platforms/discord/client.js";
const client = createDiscordClient();
import ready from "../../../src/platforms/discord/events/ready.js";

test("Discord starts online without any activity", () => {
  const { status, activities, afk, since } = client.options.presence;
  assert.deepEqual(
    { status, activities, afk, since },
    {
      status: "online",
      activities: [],
      afk: false,
      since: null,
    },
  );
  assert.equal(client.presence.status, "online");
  assert.deepEqual(client.presence.activities, []);
});

test("ready does not overwrite AI presence or initialize accounts", async () => {
  let changed = false;
  const bot = {
    user: {
      id: "123",
      username: "bot",
      globalName: "Bot",
      setPresence() {
        changed = true;
      },
    },
    guilds: { cache: new Map() },
    users: { cache: new Map() },
  };
  await ready.execute(bot);
  assert.equal(changed, false);
});
