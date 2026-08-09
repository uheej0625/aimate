import test from "node:test";
import assert from "node:assert";
import { AppEvents, EventBus } from "../../../src/core/EventBus.js";
import { registerDiscordPolicies } from "../../../src/platforms/discord/registerDiscordPolicies.js";
import { registerRetryPolicy } from "../../../src/scheduling/registerRetryPolicy.js";

test("retry policy still runs when the Discord status update fails", async () => {
  const loggedErrors = [];
  const retries = [];
  const eventBus = new EventBus({
    eventLogger: {
      error: (payload) => loggedErrors.push(payload),
    },
  });

  registerRetryPolicy({
    eventBus,
    cronJobScheduler: {
      registerRetryJob: async (...args) => retries.push(args),
    },
  });
  registerDiscordPolicies({
    eventBus,
    client: {
      user: {
        setStatus: async () => {
          throw new Error("status unavailable");
        },
      },
    },
    configManager: {
      get: () => "idle",
    },
  });

  const result = await eventBus.emitAsync(
    AppEvents.GenerationServiceUnavailable,
    {
      channelRecord: { id: 42 },
      platform: "discord",
    },
  );

  assert.deepStrictEqual(retries, [[42, "discord", 0]]);
  assert.strictEqual(result.listenerCount, 2);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(loggedErrors.length, 1);
});

test("retry policy skips registration without a channel", async () => {
  const statuses = [];
  let retryCount = 0;
  const eventBus = new EventBus();

  registerRetryPolicy({
    eventBus,
    cronJobScheduler: {
      registerRetryJob: async () => {
        retryCount += 1;
      },
    },
  });
  registerDiscordPolicies({
    eventBus,
    client: {
      user: {
        setStatus: async (status) => statuses.push(status),
      },
    },
    configManager: {
      get: () => null,
    },
  });

  await eventBus.emitAsync(AppEvents.GenerationServiceUnavailable);

  assert.deepStrictEqual(statuses, ["dnd"]);
  assert.strictEqual(retryCount, 0);
});
