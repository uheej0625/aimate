import test from "node:test";
import assert from "node:assert";
import { CronService } from "../../src/scheduling/CronService.js";

test("CronService uses a five-second polling interval by default", () => {
  const cronService = new CronService(
    {
      getPendingJobs: async () => [],
    },
    {},
    new Map(),
  );

  assert.strictEqual(cronService.pollInterval, 5000);
});
