import test from "node:test";
import assert from "node:assert";
import { CronJobWorker } from "../../src/scheduling/CronJobWorker.js";

test("CronJobWorker uses a five-second polling interval by default", () => {
  const cronJobWorker = new CronJobWorker(
    {
      getPendingJobs: async () => [],
    },
    {},
    new Map(),
  );

  assert.strictEqual(cronJobWorker.pollInterval, 5000);
});

test("CronJobWorker dispatches a due job and marks it executed", async () => {
  const buffered = [];
  const statuses = [];
  const channel = {
    platform: "cli",
    platformChannelId: "cli-channel",
  };
  const cronJobWorker = new CronJobWorker(
    {
      updateStatus: async (id, status) => statuses.push({ id, status }),
    },
    {
      add: (...args) => buffered.push(args),
    },
    new Map([
      [
        "cli",
        {
          resolveChannel: async () => channel,
          getBotId: () => "cli-bot",
        },
      ],
    ]),
  );
  const job = {
    id: 3,
    type: "ai_scheduled",
    platform: "cli",
    message: "예약 메시지",
    channel: { platformId: "cli-channel" },
  };

  await cronJobWorker.executeJob(job);

  assert.deepStrictEqual(buffered, [
    [{ channel, botId: "cli-bot", cronMessage: "예약 메시지" }],
  ]);
  assert.deepStrictEqual(statuses, [{ id: 3, status: "EXECUTED" }]);
});

test("CronJobWorker does not overlap pending job checks", async () => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const cronJobWorker = new CronJobWorker(
    {
      getPendingJobs: async () => {
        calls++;
        await blocked;
        return [];
      },
    },
    {},
    new Map(),
  );

  const first = cronJobWorker.checkAndExecuteJobs();
  const second = cronJobWorker.checkAndExecuteJobs();
  await Promise.resolve();

  assert.strictEqual(calls, 1);
  release();
  await Promise.all([first, second]);

  await cronJobWorker.checkAndExecuteJobs();
  assert.strictEqual(calls, 2);
});

test("CronJobWorker leaves transient failures pending", async () => {
  const statuses = [];
  const cronJobWorker = new CronJobWorker(
    {
      updateStatus: async (id, status) => statuses.push({ id, status }),
    },
    { add: () => {} },
    new Map([
      [
        "discord",
        {
          resolveChannel: async () => {
            throw new Error("temporary Discord failure");
          },
          getBotId: () => "bot",
        },
      ],
    ]),
  );

  await assert.rejects(
    cronJobWorker.executeJob(createJob()),
    /temporary Discord failure/,
  );
  assert.deepStrictEqual(statuses, []);
});

test("CronJobWorker leaves jobs pending when buffering fails", async () => {
  const statuses = [];
  const channel = {
    platform: "discord",
    platformChannelId: "channel-1",
  };
  const cronJobWorker = new CronJobWorker(
    {
      updateStatus: async (id, status) => statuses.push({ id, status }),
    },
    {
      add: () => {
        throw new Error("buffer unavailable");
      },
    },
    new Map([
      [
        "discord",
        {
          resolveChannel: async () => channel,
          getBotId: () => "bot",
        },
      ],
    ]),
  );

  await assert.rejects(
    cronJobWorker.executeJob(createJob()),
    /buffer unavailable/,
  );
  assert.deepStrictEqual(statuses, []);
});

test("CronJobWorker cancels jobs with no platform dispatcher", async () => {
  const statuses = [];
  const cronJobWorker = new CronJobWorker(
    {
      updateStatus: async (id, status) => statuses.push({ id, status }),
    },
    {},
    new Map(),
  );

  await cronJobWorker.executeJob(createJob());

  assert.deepStrictEqual(statuses, [{ id: 9, status: "CANCELLED" }]);
});

test("CronJobWorker cancels jobs whose channel no longer exists", async () => {
  const statuses = [];
  const cronJobWorker = new CronJobWorker(
    {
      updateStatus: async (id, status) => statuses.push({ id, status }),
    },
    {},
    new Map([
      [
        "discord",
        {
          resolveChannel: async () => null,
          getBotId: () => "bot",
        },
      ],
    ]),
  );

  await cronJobWorker.executeJob(createJob());

  assert.deepStrictEqual(statuses, [{ id: 9, status: "CANCELLED" }]);
});

function createJob() {
  return {
    id: 9,
    type: "ai_scheduled",
    platform: "discord",
    message: "예약 메시지",
    channel: { platformId: "missing-channel" },
  };
}
