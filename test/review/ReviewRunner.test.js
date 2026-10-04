import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ReviewStore } from "../../src/review/ReviewStore.js";
import { ReviewRunner, createRedactor } from "../../src/review/ReviewRunner.js";
import { ReviewError } from "../../src/review/CodexReviewer.js";
import { reviewPrompt } from "../../src/review/contracts.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aimate-review-"));
  const directory = path.join(root, "run");
  const store = await new ReviewStore(directory).open({ runId: "run" });
  t.after(async () => {
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { store, directory };
}

function reviewer() {
  return {
    initialize: async () => {},
    review: async (channel) => ({
      review: {
        nextMessage: `${channel.userName} 발언 ${channel.turnCount + 1}`,
        memorySummary: `${channel.userName}만의 평가용 기억`,
        findings: channel.turnCount
          ? [
              {
                category: "repetition",
                severity: "low",
                turns: [channel.turnCount],
                description: "반복 근거",
                suggestion: "변화 주기",
              },
            ]
          : [],
      },
      usage: null,
    }),
  };
}

function chat() {
  const sends = [];
  return {
    sends,
    initialize: async () => {},
    recover: async () => null,
    close: async () => {},
    send: async (pending) => {
      sends.push({ ...pending });
      return response(pending.number);
    },
  };
}

function response(number) {
  return {
    status: "COMPLETED",
    generationId: number,
    messages: [
      { id: `bot-${number}`, content: "답장 하나", attachments: [] },
      { id: `bot-${number}-2`, content: "답장 둘", attachments: [] },
    ],
    rawText: "# response\n\n## messages\n답장 하나[BREAK]답장 둘",
    steps: [],
    usage: null,
  };
}

test("three independent conversations rotate and final responses are evaluated", async (t) => {
  const { store, directory } = await fixture(t);
  const runtime = chat();
  await new ReviewRunner({ store, reviewer: reviewer(), chat: runtime }).run({
    maxTurns: 2,
  });
  assert.deepEqual(
    runtime.sends.map((turn) => turn.channelId),
    ["review-1", "review-2", "review-3", "review-1", "review-2", "review-3"],
  );
  assert.equal(new Set(runtime.sends.map((turn) => turn.userId)).size, 3);
  assert.ok(
    runtime.sends.every((turn) => !turn.userMessage.includes("평가용")),
  );
  assert.ok(
    store.state.channels.every(
      (channel) => channel.turnCount === 2 && channel.evaluatedThrough === 2,
    ),
  );
  assert.ok(
    store.state.channels.every((channel) =>
      channel.history.every((turn) => turn.response.messages.length === 2),
    ),
  );
  assert.match(
    await fs.readFile(path.join(directory, "report.md"), "utf8"),
    /반복 근거/,
  );
  assert.equal(store.state.findingCounts["repetition:low"], 6);
});

test("resume recovers a completed DB turn without resending its user input", async (t) => {
  const { store, directory } = await fixture(t);
  const pending = {
    channelId: "review-1",
    number: 1,
    messageId: "saved-input",
    userMessage: "이미 전송",
    userId: "review-user-1",
    userName: "지우",
  };
  await store.record({ type: "prepared", turn: pending });
  await store.record({
    type: "delivered",
    message: { id: "bot-delivered", content: "전송 확인", attachments: [] },
  });
  await store.close();
  const resumed = await new ReviewStore(directory).open({
    runId: "run",
    resume: true,
  });
  t.after(() => resumed.close());
  const runtime = chat();
  runtime.recover = async () => response(1);
  await new ReviewRunner({
    store: resumed,
    reviewer: reviewer(),
    chat: runtime,
  }).run({ maxTurns: 1 });
  assert.equal(runtime.sends.length, 2);
  assert.ok(runtime.sends.every((turn) => turn.channelId !== "review-1"));
  assert.equal(
    resumed.state.channels[0].history[0].response.messages.length,
    3,
  );
});

test("resume reuses an already stored review instead of evaluating it twice", async (t) => {
  const { store, directory } = await fixture(t);
  await store.record({
    type: "reviewed",
    channelId: "review-1",
    review: {
      nextMessage: "저장된 다음 말",
      memorySummary: "",
      findings: [],
    },
  });
  await store.close();
  const resumed = await new ReviewStore(directory).open({
    runId: "run",
    resume: true,
  });
  t.after(() => resumed.close());
  const runtime = chat();
  await new ReviewRunner({
    store: resumed,
    reviewer: reviewer(),
    chat: runtime,
  }).run({ maxTurns: 1 });
  assert.equal(runtime.sends[0].userMessage, "저장된 다음 말");
});

for (const code of ["codex_limit", "codex_auth", "codex_output"]) {
  test(`${code} stops without retrying and preserves earlier replies`, async (t) => {
    const { store } = await fixture(t);
    const judge = reviewer();
    let calls = 0;
    const original = judge.review;
    judge.review = async (channel) => {
      if (++calls === 4) throw new ReviewError(code, "failure");
      return original(channel);
    };
    const runtime = chat();
    await assert.rejects(
      new ReviewRunner({ store, reviewer: judge, chat: runtime }).run(),
      { code },
    );
    assert.equal(calls, 4);
    assert.equal(runtime.sends.length, 3);
    assert.equal(store.state.stopReason, code);
    assert.ok(store.state.channels.every((channel) => channel.turnCount === 1));
  });
}

test("invalid mocked output is rejected before a user message is sent", async (t) => {
  const { store } = await fixture(t);
  const judge = reviewer();
  judge.review = async () => ({
    review: { nextMessage: "", memorySummary: "", findings: [] },
  });
  const runtime = chat();
  await assert.rejects(
    new ReviewRunner({ store, reviewer: judge, chat: runtime }).run(),
    /Invalid Codex/,
  );
  assert.equal(runtime.sends.length, 0);
});

test("timeout aborts a stalled chat and leaves pending input recoverable", async (t) => {
  const { store } = await fixture(t);
  const runtime = chat();
  let aborted = false;
  runtime.send = (_turn, { signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(signal.reason);
      }),
    );
  await assert.rejects(
    new ReviewRunner({
      store,
      reviewer: reviewer(),
      chat: runtime,
      timeoutMs: 25,
    }).run(),
    { code: "timeout" },
  );
  assert.equal(aborted, true);
  assert.equal(store.state.pending.number, 1);
  assert.equal(store.state.stopReason, "timeout");
});

test("manual stop saves confirmed delivery even before response completion", async (t) => {
  const { store } = await fixture(t);
  const controller = new AbortController();
  const runtime = chat();
  runtime.send = async () => {
    await store.record({
      type: "delivered",
      message: { id: "confirmed", content: "확인된 메시지" },
    });
    controller.abort(new DOMException("Stop", "AbortError"));
    throw controller.signal.reason;
  };
  await new ReviewRunner({ store, reviewer: reviewer(), chat: runtime }).run({
    signal: controller.signal,
  });
  assert.equal(store.state.stopReason, "manual_stop");
  assert.equal(store.state.pending.deliveries[0].content, "확인된 메시지");
});

test("journal replay repairs a torn final append and rebuilds stale snapshots", async (t) => {
  const { store, directory } = await fixture(t);
  await store.close();
  await fs.appendFile(path.join(directory, "events.jsonl"), '{"type":"broken');
  await fs.writeFile(path.join(directory, "state.json"), "stale");
  const resumed = await new ReviewStore(directory).open({
    runId: "run",
    resume: true,
  });
  t.after(() => resumed.close());
  assert.equal(resumed.state.runId, "run");
  const lines = (
    await fs.readFile(path.join(directory, "events.jsonl"), "utf8")
  )
    .trim()
    .split("\n");
  assert.ok(lines.every((line) => JSON.parse(line)));
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, "state.json"), "utf8"))
      .status,
    "running",
  );
});

test("sensitive metadata and known credential values are redacted", () => {
  const redact = createRedactor(["private-key-value"]);
  const data = redact({
    text: "private-key-value",
    headers: { authorization: "secret" },
    nested: ["Bearer abcdefghijklmnop"],
    systemInstruction: "private prompt",
  });
  assert.equal(data.text, "[REDACTED]");
  assert.equal(data.headers, "[REDACTED]");
  assert.equal(data.nested[0], "[REDACTED]");
  assert.equal(data.systemInstruction, "[REDACTED]");
});

test("journal replay preserves a complete last record without its newline", async (t) => {
  const { store, directory } = await fixture(t);
  await store.close();
  const filename = path.join(directory, "events.jsonl");
  const content = await fs.readFile(filename, "utf8");
  await fs.writeFile(filename, content.trimEnd());
  const resumed = await new ReviewStore(directory).open({
    runId: "run",
    resume: true,
  });
  t.after(() => resumed.close());
  const lines = (await fs.readFile(filename, "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).type, "resumed");
});

test("review inputs keep only 40 turns and bounded previous findings", async (t) => {
  const { store } = await fixture(t);
  for (let number = 1; number <= 45; number++) {
    await store.record({
      type: "responded",
      turn: {
        channelId: "review-1",
        number,
        userMessage: `발언 ${number}`,
        response: response(number),
      },
    });
  }
  const channel = store.state.channels[0];
  assert.equal(channel.history.length, 40);
  assert.equal(channel.history[0].number, 6);
  assert.doesNotMatch(reviewPrompt(channel), /발언 1"/);
});
