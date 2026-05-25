import test from "node:test";
import assert from "node:assert";
import { EventBus } from "../../src/core/EventBus.js";

test("EventBus emitAsync runs listeners in order", async () => {
  const bus = new EventBus({
    eventLogger: {
      error: () => {},
    },
  });
  const calls = [];

  bus.on("example", async (payload) => {
    calls.push(`first:${payload.value}`);
  });
  bus.on("example", async () => {
    calls.push("second");
  });

  const result = await bus.emitAsync("example", { value: "ok" });

  assert.deepStrictEqual(calls, ["first:ok", "second"]);
  assert.strictEqual(result.listenerCount, 2);
  assert.deepStrictEqual(result.errors, []);
});

test("EventBus emitAsync captures listener errors", async () => {
  const logged = [];
  const bus = new EventBus({
    eventLogger: {
      error: (payload) => logged.push(payload),
    },
  });

  bus.on("example", async () => {
    throw new Error("listener failed");
  });
  bus.on("example", async () => {});

  const result = await bus.emitAsync("example");

  assert.strictEqual(result.listenerCount, 2);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(logged.length, 1);
});
