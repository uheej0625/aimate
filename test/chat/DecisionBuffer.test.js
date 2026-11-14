import test from "node:test";
import assert from "node:assert/strict";
import { DecisionBuffer } from "../../src/chat/decision/DecisionBuffer.js";
import { ConversationSession } from "../../src/chat/ConversationSession.js";

const flush = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness(t, action = "ignore") {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  t.mock.method(performance, "now", () => Date.now());
  const session = new ConversationSession();
  const channel = { platform: "discord", platformChannelId: "one" };
  const key = session.key(channel);
  const calls = [],
    starts = [],
    cancels = [];
  const decider = {
    evaluate: async (state, signal) => {
      calls.push({ state, signal });
      return action;
    },
  };
  const policy = { isEnabled: async () => true };
  const buffer = new DecisionBuffer({
    settings: {
      debounceMs: 1000,
      maxWaitMs: 5000,
      recheckMs: 5000,
      maxContextMessages: 20,
    },
    conversationSession: session,
    conversationPolicy: policy,
    decider,
    contextBuilder: {
      build: async (_request, batch, assistant) => ({
        state: {
          assistant,
          ids: [...batch.ids],
          recheck: batch.rechecks,
          through: batch.throughEventId,
        },
        throughEventId: batch.throughEventId + batch.ids.size,
      }),
    },
    chatFlow: { execute: async (request) => starts.push(request) },
    generationAbortRegistry: {
      abortChannel: (id) => cancels.push(["abort", id]),
    },
    generationLifecycle: {
      cancelActiveForChannel: async (id) => cancels.push(["cancel", id]),
    },
  });
  t.after(() => buffer.clearAll());
  return {
    session,
    channel,
    key,
    calls,
    starts,
    cancels,
    decider,
    buffer,
    policy,
    add(id = "m1", channelPort = channel) {
      session.observe(session.key(channelPort));
      buffer.add({
        channelPort,
        internalChannelId: channelPort.platformChannelId,
        botId: "bot",
        changedMessageIds: [id],
      });
    },
    async tick(ms) {
      t.mock.timers.tick(ms);
      await flush();
    },
  };
}

test("decision debounce combines messages and maximum wait prevents starvation", async (t) => {
  const h = harness(t);
  h.add("a");
  await h.tick(500);
  h.add("b");
  await h.tick(999);
  assert.equal(h.calls.length, 0);
  await h.tick(1);
  assert.deepEqual(h.calls[0].state.ids, ["a", "b"]);
  assert.equal(h.starts.length, 0);
  h.add("c");
  for (let i = 0; i < 6; i++) {
    await h.tick(800);
    h.add(`burst-${i}`);
  }
  await h.tick(200);
  assert.equal(h.calls.length, 2);
  await h.tick(30_000);
  assert.equal(h.calls.length, 2, "ignore is not polled");
});

test("one in-flight call per channel, newer input invalidates the old action without blocking ingestion", async (t) => {
  const h = harness(t, "respond");
  const pending = deferred();
  let count = 0;
  h.decider.evaluate = async (state, signal) => {
    h.calls.push({ state, signal });
    return ++count === 1 ? pending.promise : "respond";
  };
  h.add("old");
  await h.tick(1000);
  await h.session.run(h.key, () => h.add("new"));
  await h.tick(10_000);
  assert.equal(h.calls.length, 1);
  pending.resolve("respond");
  await flush();
  assert.equal(h.starts.length, 0);
  await h.tick(0);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].state.ids, ["old", "new"]);
  assert.equal(h.starts.length, 1);
});

test("different channels can decide concurrently", async (t) => {
  const h = harness(t);
  const pending = deferred();
  h.decider.evaluate = async (state, signal) => {
    h.calls.push({ state, signal });
    return pending.promise;
  };
  h.add("a");
  h.add("b", { ...h.channel, platform: "cli" });
  await h.tick(1000);
  assert.equal(h.calls.length, 2);
  pending.resolve("ignore");
  await flush();
});

test("wait rechecks only once, keeps pending input, and new input starts a new bounded wait", async (t) => {
  const h = harness(t, "wait");
  h.add();
  await h.tick(1000);
  await h.tick(4999);
  assert.equal(h.calls.length, 1);
  await h.tick(1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].state.recheck, 1);
  assert.deepEqual(h.calls[1].state.ids, ["m1"]);
  await h.tick(60_000);
  assert.equal(h.calls.length, 2);
  h.add("m2");
  await h.tick(1000);
  assert.equal(h.calls[2].state.recheck, 0);
  assert.deepEqual(h.calls[2].state.ids, ["m1", "m2"]);
});

for (const action of ["keep", "restart", "stop", "wait"]) {
  test(`active generation: ${action} applies only after the decision`, async (t) => {
    const h = harness(t, action);
    const turn = h.session.begin(h.key);
    h.session.recordInput(h.key, turn, 42);
    h.add();
    assert.equal(h.session.isCurrent(h.key, turn), true);
    assert.equal(h.cancels.length, 0);
    await h.tick(1000);
    assert.equal(h.calls[0].state.assistant.inputThroughEventId, 42);
    assert.equal(h.session.isCurrent(h.key, turn), action === "keep");
    assert.equal(h.starts.length, action === "restart" ? 1 : 0);
    assert.equal(
      h.cancels.length,
      action === "keep" ? 0 : action === "restart" ? 1 : 2,
    );
  });
}

test("a delivered or completed generation invalidates an in-flight decision", async (t) => {
  const h = harness(t);
  const turn = h.session.begin(h.key);
  const pending = deferred();
  h.decider.evaluate = () => pending.promise;
  h.add();
  await h.tick(1000);
  h.session.recordDelivery(h.key, turn);
  h.session.settle(h.key, turn);
  pending.resolve("restart");
  await flush();
  assert.equal(h.starts.length, 0);
  assert.equal(h.cancels.length, 0);
  assert.equal(h.buffer.has(h.channel), true);
});

test("failure preserves current generation and does not automatically loop", async (t) => {
  const h = harness(t);
  const turn = h.session.begin(h.key);
  h.decider.evaluate = async () => {
    h.calls.push({});
    throw new Error("unavailable");
  };
  h.add();
  await h.tick(1000);
  await h.tick(30_000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.session.isCurrent(h.key, turn), true);
  assert.equal(h.cancels.length, 0);
  h.add("retry-on-input");
  await h.tick(1000);
  assert.equal(h.calls.length, 2);
});

test("clear aborts a pending request and its late result cannot start generation", async (t) => {
  const h = harness(t);
  const pending = deferred();
  let signal;
  h.decider.evaluate = (_state, value) => {
    signal = value;
    return pending.promise;
  };
  h.add();
  await h.tick(1000);
  assert.equal(h.buffer.clear(h.channel), true);
  assert.equal(signal.aborted, true);
  pending.resolve("respond");
  await flush();
  await h.tick(30_000);
  assert.equal(h.starts.length, 0);
  assert.equal(h.buffer.buffers.size, 0);
  assert.equal(h.buffer.tasks.size, 0);
});

test("disabled policy prevents both pending calls and applying an in-flight result", async (t) => {
  const h = harness(t, "respond");
  h.add();
  h.policy.isEnabled = async () => false;
  await h.tick(1000);
  assert.equal(h.calls.length, 0);
  h.policy.isEnabled = async () => true;
  const pending = deferred();
  h.decider.evaluate = () => pending.promise;
  h.add();
  await h.tick(1000);
  h.policy.isEnabled = async () => false;
  pending.resolve("respond");
  await flush();
  assert.equal(h.starts.length, 0);
  assert.equal(h.buffer.has(h.channel), false);
});
