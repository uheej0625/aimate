import test from "node:test";
import assert from "node:assert/strict";
import { ConversationSession } from "../../src/chat/ConversationSession.js";

test("watching spans work and expires exactly ten minutes after completion", () => {
  let now = 0;
  const session = new ConversationSession({ now: () => now });
  assert.equal(session.isWatching("channel"), false);
  const turn = session.begin("channel");
  now = 2_000_000;
  assert.equal(session.isWatching("channel"), true);
  session.settle("channel", turn);
  now += 599_999;
  assert.equal(session.isWatching("channel"), true);
  now++;
  assert.equal(session.isWatching("channel"), false);
  assert.equal(new ConversationSession().isWatching("channel"), false);
});

test("old work cannot settle or extend the new turn", () => {
  let now = 0;
  const session = new ConversationSession({ now: () => now });
  const old = session.begin("channel");
  const current = session.begin("channel");
  session.settle("channel", old);
  now = 1_000_000;
  assert.equal(session.isCurrent("channel", current), true);
  session.settle("channel", current, 1_000_000);
  session.settle("channel", old, 2_000_000);
  assert.equal(session.isWatching("channel", 1_600_000), false);
});

test("queue preserves receive order, survives rejection, and does not block other channels", async () => {
  const session = new ConversationSession();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const first = session.run("a", async () => {
    await gate;
    calls.push(1);
    throw new Error("fetch failed");
  });
  const rejected = assert.rejects(first, /fetch failed/);
  const second = session.run("a", () => calls.push(2));
  await session.run("b", () => calls.push("other"));
  assert.deepEqual(calls, ["other"]);
  release();
  await rejected;
  await second;
  assert.deepEqual(calls, ["other", 1, 2]);
});
