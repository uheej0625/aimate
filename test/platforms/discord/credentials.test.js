import test from "node:test";
import assert from "node:assert";
import {
  getDiscordTokenEnvKey,
  getRequiredDiscordToken,
} from "../../../src/platforms/discord/credentials.js";

const configManager = {
  get: (key) => (key === "character" ? "alice-v2" : undefined),
};

test("Discord credentials derive the token environment variable from character ID", () => {
  assert.strictEqual(
    getDiscordTokenEnvKey("alice-v2"),
    "AIMATE_DISCORD_ALICE_V2_TOKEN",
  );
  assert.strictEqual(
    getRequiredDiscordToken(configManager, {
      AIMATE_DISCORD_ALICE_V2_TOKEN: " discord-token ",
    }),
    "discord-token",
  );
});

test("Discord credentials report the missing character-specific token", () => {
  assert.throws(
    () => getRequiredDiscordToken(configManager, {}),
    /AIMATE_DISCORD_ALICE_V2_TOKEN/,
  );
});
