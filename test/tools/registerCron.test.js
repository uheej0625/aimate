import test from "node:test";
import assert from "node:assert";
import registerCron from "../../src/tools/definitions/registerCron.js";

test("register_cron_job anchors relative time to the user request", async () => {
  const requestCreatedAt = new Date("2026-08-01T15:21:03.000Z");
  let registeredData = null;
  const cronService = {
    registerJob: async (data) => {
      registeredData = data;
      return { id: 7, ...data };
    },
  };

  const result = await registerCron.execute(
    { scheduledTime: "2m", message: "아무 메시지" },
    {
      cronService,
      channel: { id: "channel-1", platform: "discord" },
      requestCreatedAt,
    },
  );

  assert.strictEqual(
    registeredData.scheduledAt.toISOString(),
    "2026-08-01T15:23:03.000Z",
  );
  assert.strictEqual(result.scheduledAt, "2026-08-01T15:23:03.000Z");
  assert.match(result.message, /예약했어/);
});
