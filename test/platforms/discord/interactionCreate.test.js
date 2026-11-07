import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import interactionEvent from "../../../src/platforms/discord/events/interactionCreate.js";
import { captureLogs } from "../../helpers/logs.js";

for (const kind of ["slash", "message"]) {
  test(`unregistered ${kind} command replies privately with registration guidance`, async (t) => {
    const records = captureLogs(t);
    const replies = [];
    const interaction = {
      commandName: "대화",
      isChatInputCommand: () => kind === "slash",
      isMessageContextMenuCommand: () => kind === "message",
      reply: async (payload) => replies.push(payload),
    };

    await interactionEvent.execute(interaction, {
      client: { commands: new Map() },
    });

    assert.equal(replies.length, 1);
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
    assert.match(replies[0].content, /지원하지 않는 명령어/);
    assert.match(replies[0].content, /재등록/);
    assert.equal(records.length, 1);
    assert.equal(records[0].event, "command.not_found");
    assert.equal(records[0].commandName, "대화");
  });
}
