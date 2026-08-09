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
  const cronJobWorker = new CronJobWorker(
    {
      updateStatus: async (id, status) => statuses.push({ id, status }),
    },
    {
      add: (...args) => buffered.push(args),
    },
    new Map([["cli", { user: { id: "cli-bot" } }]]),
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
    ["cli-channel", job.channel, "cli-bot", "예약 메시지"],
  ]);
  assert.deepStrictEqual(statuses, [{ id: 3, status: "EXECUTED" }]);
});
