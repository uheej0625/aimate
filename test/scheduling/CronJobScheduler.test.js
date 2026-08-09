import test from "node:test";
import assert from "node:assert";
import { CronJobScheduler } from "../../src/scheduling/CronJobScheduler.js";

test("CronJobScheduler registers jobs through the repository", async () => {
  let createdData = null;
  const scheduler = new CronJobScheduler({
    create: async (data) => {
      createdData = data;
      return { id: 7, ...data };
    },
  });
  const data = {
    channelId: "channel-1",
    platform: "discord",
    scheduledAt: new Date("2026-08-01T15:23:03.000Z"),
    type: "ai_scheduled",
    message: "알림",
  };

  const job = await scheduler.registerJob(data);

  assert.strictEqual(createdData, data);
  assert.strictEqual(job.id, 7);
});

test("CronJobScheduler increments retry count for LLM retries", async (t) => {
  let createdData = null;
  const now = new Date("2026-08-01T15:21:03.000Z");
  t.mock.method(Date, "now", () => now.getTime());
  t.mock.method(Math, "random", () => 0);
  const scheduler = new CronJobScheduler({
    create: async (data) => {
      createdData = data;
      return { id: 8, ...data };
    },
  });
  await scheduler.registerRetryJob("channel-1", "discord", 2);

  assert.strictEqual(createdData.channelId, "channel-1");
  assert.strictEqual(createdData.platform, "discord");
  assert.strictEqual(createdData.type, "llm_retry");
  assert.strictEqual(createdData.retryCount, 3);
  assert.strictEqual(
    createdData.scheduledAt.toISOString(),
    "2026-08-01T16:21:03.000Z",
  );
});
