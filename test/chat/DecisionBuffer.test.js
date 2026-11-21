import test from "node:test";
import assert from "node:assert/strict";
import { DecisionBuffer } from "../../src/chat/decision/DecisionBuffer.js";
import { ConversationSession } from "../../src/chat/ConversationSession.js";

const flush = () => new Promise(setImmediate);
const outcome = (action) => ({
  action,
  probabilities: { [action]: 1 },
  usage: { inputTokens: 10 },
  apiResponse: { answers: { action: { choice: action } } },
  durationMs: 25,
});
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
    settings: {
      provider: "gateway",
      model: "parallel/parallel-decisions-fast",
      prompt: "minimal",
    },
    evaluate: async (state, signal) => {
      calls.push({ state, signal });
      return outcome(action);
    },
  };
  const policy = { isEnabled: async () => true };
  const generations = [];
  const generationRepository = {
    create: async (data) => {
      const record = { id: generations.length + 1, ...data };
      generations.push(record);
      return record;
    },
    updateDetails: async (id, details) =>
      Object.assign(
        generations.find((g) => g.id === id),
        details,
      ),
    updateDetailsAndStatusIfCurrent: async (id, _expected, status, details) => {
      Object.assign(
        generations.find((g) => g.id === id),
        details,
        { status },
      );
      return true;
    },
  };
  const buffer = new DecisionBuffer({
    settings: {
      debounceMs: 1000,
      maxWaitMs: 5000,
      recheckMs: 5000,
      recheckMultiplier: 2,
      maxRecheckMs: 30000,
      maxContextMessages: 20,
    },
    conversationSession: session,
    conversationPolicy: policy,
    decider,
    generationRepository,
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
    generations,
    generationRepository,
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
    return ++count === 1 ? pending.promise : outcome("respond");
  };
  h.add("old");
  await h.tick(1000);
  await h.session.run(h.key, () => h.add("new"));
  await h.tick(10_000);
  assert.equal(h.calls.length, 1);
  pending.resolve(outcome("respond"));
  await flush();
  assert.equal(h.starts.length, 0);
  assert.equal(h.generations[0].status, "COMPLETED");
  assert.deepEqual(h.generations[0].metadata.application, {
    applied: false,
    reason: "new_input",
  });
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
  pending.resolve(outcome("ignore"));
  await flush();
});

test("wait repeatedly rechecks with capped exponential delays and new input resets the backoff", async (t) => {
  const h = harness(t, "wait");
  h.add();
  await h.tick(1000);
  await h.tick(4999);
  assert.equal(h.calls.length, 1);
  await h.tick(1);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].state.recheck, 1);
  assert.deepEqual(h.calls[1].state.ids, ["m1"]);
  for (const delay of [10000, 20000, 30000, 30000]) {
    const previous = h.calls.length;
    await h.tick(delay - 1);
    assert.equal(h.calls.length, previous);
    await h.tick(1);
    assert.equal(h.calls.length, previous + 1);
    assert.equal(h.calls.at(-1).state.recheck, previous);
  }
  const previous = h.calls.length;
  h.add("m2");
  await h.tick(1000);
  assert.equal(h.calls.length, previous + 1);
  assert.equal(h.calls.at(-1).state.recheck, 0);
  assert.deepEqual(h.calls.at(-1).state.ids, ["m1", "m2"]);
  await h.tick(4999);
  assert.equal(h.calls.length, previous + 1);
  await h.tick(1);
  assert.equal(h.calls.at(-1).state.recheck, 1);
});

test("custom wait multiplier and cap control the repeated schedule", async (t) => {
  const h = harness(t, "wait");
  Object.assign(h.buffer.settings, {
    recheckMs: 100,
    recheckMultiplier: 1.5,
    maxRecheckMs: 200,
  });
  h.add();
  await h.tick(1000);
  for (const delay of [100, 150, 200, 200]) {
    const previous = h.calls.length;
    await h.tick(delay - 1);
    assert.equal(h.calls.length, previous);
    await h.tick(1);
    assert.equal(h.calls.length, previous + 1);
  }
});

for (const [probabilities, delay] of [
  [{ wait: 0.45, respond: 0.45, ignore: 0.1 }, 2500],
  [{ wait: 0.45, respond: 0.4, ignore: 0.15 }, 3125],
  [{ wait: 0.4, respond: 0.25, ignore: 0.35 }, 5000],
  [{ wait: 0.8, respond: 0.2 }, 5000],
  [undefined, 5000],
]) {
  test(`first wait interval for ${JSON.stringify(probabilities)} is ${delay}ms`, async (t) => {
    const h = harness(t, "wait");
    h.decider.evaluate = async (state) => {
      h.calls.push(state);
      return { ...outcome("wait"), probabilities };
    };
    h.add();
    await h.tick(1000);
    assert.equal(h.generations[0].metadata.application.recheckDelayMs, delay);
    await h.tick(delay - 1);
    assert.equal(h.calls.length, 1);
    await h.tick(1);
    assert.equal(h.calls.length, 2);
    await h.tick(9999);
    assert.equal(h.calls.length, 2);
    await h.tick(1);
    assert.equal(h.calls.length, 3, "the second interval uses normal backoff");
  });
}

for (const action of ["respond", "ignore"]) {
  test(`wait polling ends when a recheck decides ${action}`, async (t) => {
    const h = harness(t, "wait");
    h.add();
    await h.tick(1000);
    h.decider.evaluate = async (state) => {
      h.calls.push({ state });
      return outcome(action);
    };
    await h.tick(5000);
    await h.tick(60000);
    assert.equal(h.calls.length, 2);
    assert.equal(h.starts.length, action === "respond" ? 1 : 0);
    assert.equal(h.buffer.has(h.channel), false);
  });
}

test("zero debounce starts judging without an intentional scheduling delay", async (t) => {
  const h = harness(t);
  h.buffer.settings.debounceMs = 0;
  h.add("first");
  await h.tick(0);
  assert.equal(h.calls.length, 1);
  h.add("second");
  await h.tick(0);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].state.ids, ["second"]);
});

test("zero debounce coalesces input received during an active call into one follow-up decision", async (t) => {
  const h = harness(t);
  h.buffer.settings.debounceMs = 0;
  const pending = deferred();
  h.decider.evaluate = async (state, signal) => {
    h.calls.push({ state, signal });
    return h.calls.length === 1 ? pending.promise : outcome("ignore");
  };
  h.add("first");
  await h.tick(0);
  h.add("second");
  h.add("third");
  await h.tick(0);
  assert.equal(h.calls.length, 1);
  pending.resolve(outcome("ignore"));
  await flush();
  await h.tick(0);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].state.ids, ["first", "second", "third"]);
  assert.equal(h.generations[0].metadata.application.reason, "new_input");
  await h.tick(60000);
  assert.equal(h.calls.length, 2);
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
  pending.resolve(outcome("restart"));
  await flush();
  assert.equal(h.starts.length, 0);
  assert.equal(h.cancels.length, 0);
  assert.equal(h.buffer.has(h.channel), true);
  assert.deepEqual(h.generations[0].metadata.application, {
    applied: false,
    reason: "assistant_changed",
  });
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
  assert.equal(h.generations[0].status, "FAILED");
  assert.equal(h.generations[0].metadata.application.reason, "failed");
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
  pending.resolve(outcome("respond"));
  await flush();
  await h.tick(30_000);
  assert.equal(h.starts.length, 0);
  assert.equal(h.buffer.buffers.size, 0);
  assert.equal(h.buffer.tasks.size, 0);
  assert.equal(
    h.generations[0].status,
    "COMPLETED",
    "successful late API result is distinct from cancelled application",
  );
  assert.deepEqual(h.generations[0].metadata.application, {
    applied: false,
    reason: "cancelled",
  });
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
  pending.resolve(outcome("respond"));
  await flush();
  assert.equal(h.starts.length, 0);
  assert.equal(h.buffer.has(h.channel), false);
  assert.deepEqual(h.generations[0].metadata.application, {
    applied: false,
    reason: "channel_disabled",
  });
});

test("each wait recheck is a separate completed decision generation", async (t) => {
  const h = harness(t, "wait");
  h.add();
  await h.tick(1000);
  await h.tick(5000);
  assert.equal(h.generations.length, 2);
  for (const record of h.generations) {
    assert.equal(record.type, "DECISION");
    assert.equal(record.status, "COMPLETED");
    assert.equal(record.metadata.application.applied, true);
    assert.equal(JSON.parse(record.output).action, "wait");
  }
});

test("API abort and timeout are recorded without restarting the active chat", async (t) => {
  const h = harness(t);
  const turn = h.session.begin(h.key);
  h.decider.evaluate = async () => {
    throw new DOMException("timeout", "TimeoutError");
  };
  h.add();
  await h.tick(1000);
  assert.equal(h.generations[0].status, "FAILED");
  assert.equal(h.generations[0].metadata.application.reason, "timeout");
  h.decider.evaluate = (_state, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  h.add("cancelled-input");
  await h.tick(1000);
  h.buffer.clear(h.channel);
  await flush();
  assert.equal(h.generations[1].status, "CANCELLED");
  assert.equal(h.generations[1].metadata.application.reason, "cancelled");
  assert.equal(h.session.isCurrent(h.key, turn), true);
});

test("new input during persistence does not inherit an old wait recheck delay", async (t) => {
  const h = harness(t, "wait");
  const writing = deferred();
  const save = h.generationRepository.updateDetailsAndStatusIfCurrent;
  h.generationRepository.updateDetailsAndStatusIfCurrent = async (...args) => {
    await writing.promise;
    return save(...args);
  };
  h.add();
  await h.tick(1000);
  h.add("new-input");
  writing.resolve();
  await flush();
  await h.tick(1000);
  assert.equal(h.calls.length, 2);
});

test("successful API and failed action application have distinct statuses", async (t) => {
  const h = harness(t, "stop");
  h.session.begin(h.key);
  h.buffer.generationLifecycle.cancelActiveForChannel = async () => {
    throw new Error("storage unavailable");
  };
  h.add();
  await h.tick(1000);
  assert.equal(h.generations[0].status, "COMPLETED");
  assert.deepEqual(h.generations[0].metadata.application, {
    applied: false,
    reason: "apply_failed",
  });
  assert.equal(h.generations[0].metadata.error.name, "Error");
  assert.equal(h.starts.length, 0);
});
