import test from "node:test";
import assert from "node:assert/strict";
import client from "../../../src/platforms/discord/client.js";
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

for (const fails of [false, true]) {
  test(`ready does not overwrite AI presence when account initialization ${fails ? "fails" : "succeeds"}`, async () => {
    let initialized = false;
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
    await ready.execute(bot, {
      botAccountService: {
        async initBotAccount(account) {
          initialized = true;
          assert.equal(account.platformId, "123");
          if (fails) throw new Error("account unavailable");
        },
      },
    });
    assert.equal(initialized, true);
    assert.equal(changed, false);
  });
}
