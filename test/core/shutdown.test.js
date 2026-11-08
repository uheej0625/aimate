import test from "node:test";
import assert from "node:assert/strict";
import { registerShutdown } from "../../src/core/shutdown.js";

test("shutdown registers one host handler and ignores repeated signals", async () => {
  const calls = [];
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const unregister = registerShutdown({
    host: {
      async close() {
        calls.push("host");
        await pending;
      },
    },
    exit: (code) => calls.push(code),
  });
  try {
    process.emit("SIGINT");
    process.emit("SIGTERM");
    assert.deepEqual(calls, ["host"]);
    finish();
    await new Promise(setImmediate);
    assert.deepEqual(calls, ["host", 0]);
  } finally {
    unregister();
  }
});
