import test from "node:test";
import assert from "node:assert/strict";
import { MessageHandler } from "../../src/messages/MessageHandler.js";
import { ConversationSession } from "../../src/chat/ConversationSession.js";

function harness(overrides = {}) {
  let now = 0;
  const session = new ConversationSession({ now: () => now });
  const calls = [];
  const requests = [];
  const channel = { platform: "discord", platformChannelId: "channel" };
  const service = {
    saveMessage: async () => ({ changed: true }),
    updateMessage: async (_message, options) => {
      calls.push(["update", options.observed]);
      return { changed: true };
    },
    deleteMessages: async (_platform, _ids, _channelId, options) => {
      calls.push(["delete", options.observed]);
      return {
        deletedCount: 1,
        deletedMessages: [
          { authorId: "user", isBot: false, author: { platformId: "user" } },
        ],
      };
    },
    ...overrides,
  };
  const handler = new MessageHandler(
    service,
    { cancelActiveForChannel: async () => calls.push("cancel") },
    { add: (request) => requests.push(request) },
    { findByPlatformId: async () => ({ id: "internal" }) },
    { abortChannel: () => calls.push("abort") },
    session,
  );
  const message = {
    platform: "discord",
    platformMessageId: "m1",
    platformChannelId: "channel",
    content: "hello",
    author: { platformUserId: "user", isBot: false },
  };
  return {
    handler,
    session,
    channel,
    calls,
    requests,
    message,
    key: session.key(channel),
    setTime: (value) => {
      now = value;
    },
    handle: (kind, extra = {}) =>
      handler.handle({
        kind,
        channel,
        botId: "bot",
        message,
        platformMessageIds: ["m1"],
        ...extra,
      }),
  };
}

test("new input starts watching and cancels active generation before buffering", async () => {
  const h = harness();
  await h.handle("CREATE");
  assert.deepEqual(h.calls, ["abort", "cancel"]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.session.isCurrent(h.key, h.requests[0].turnId), true);
});

test("bots and duplicate events do not start or prolong watching", async () => {
  const h = harness({
    saveMessage: async () => ({ changed: false }),
    updateMessage: async () => ({ changed: false }),
  });
  await h.handle("CREATE");
  await h.handle("CREATE", {
    message: { ...h.message, author: { platformUserId: "bot", isBot: true } },
  });
  assert.equal(h.session.isWatching(h.key), false);
  const turn = h.session.begin(h.key);
  h.session.settle(h.key, turn);
  h.setTime(599_999);
  await h.handle("UPDATE");
  h.setTime(600_000);
  assert.equal(h.session.isWatching(h.key), false);
  assert.equal(h.requests.length, 0);
});

test("edits and deletions while idle change current state without scheduling", async () => {
  const h = harness();
  await h.handle("UPDATE");
  await h.handle("DELETE");
  assert.deepEqual(h.calls, [
    ["update", false],
    ["delete", false],
  ]);
  assert.equal(h.requests.length, 0);
});

test("an empty edit and user deletion remain observable during generation and grace", async () => {
  const h = harness();
  await h.handle("CREATE");
  await h.handle("UPDATE", { message: { ...h.message, content: "" } });
  assert.deepEqual(h.calls.slice(-3), [["update", true], "abort", "cancel"]);
  h.session.settle(h.key, h.requests.at(-1).turnId);
  h.setTime(599_999);
  await h.handle("DELETE");
  assert.equal(h.requests.length, 3);
  h.session.settle(h.key, h.requests.at(-1).turnId);
  h.setTime(1_199_999);
  await h.handle("DELETE");
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.calls.at(-1), ["delete", false]);
});

test("bulk deletion schedules once and bot-only deletion never schedules", async () => {
  const h = harness();
  h.session.begin(h.key);
  await h.handle("DELETE", { platformMessageIds: ["m1", "m2", "m3"] });
  assert.equal(h.requests.length, 1);
  const bots = harness({
    deleteMessages: async () => ({
      deletedCount: 1,
      deletedMessages: [{ isBot: true }],
    }),
  });
  bots.session.begin(bots.key);
  await bots.handle("DELETE");
  assert.equal(bots.requests.length, 0);
});

test("partial hydration preserves ordering and uses reception time at the ten-minute boundary", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const h = harness();
  const turn = h.session.begin(h.key);
  h.session.settle(h.key, turn);
  h.setTime(599_999);
  const edit = h.handle("UPDATE", {
    message: undefined,
    loadMessage: async () => {
      await gate;
      return h.message;
    },
  });
  await Promise.resolve();
  h.setTime(700_000);
  const deletion = h.handle("DELETE");
  release();
  await Promise.all([edit, deletion]);
  assert.deepEqual(h.calls.filter(Array.isArray), [
    ["update", true],
    ["delete", true],
  ]);
  assert.equal(h.requests.length, 2);
});

test("a later new message does not retroactively observe an earlier idle edit", async () => {
  const h = harness();
  await Promise.all([h.handle("UPDATE"), h.handle("CREATE")]);
  assert.deepEqual(h.calls[0], ["update", false]);
  assert.equal(h.requests.length, 1);
});
