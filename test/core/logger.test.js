import test from "node:test";
import assert from "node:assert";
import logger, { createLogger } from "../../src/core/logger.js";

test("logger tests", async (t) => {
  await t.test(
    "createLogger should return a child logger with module property",
    () => {
      const childLogger = createLogger("TestModule");
      assert.strictEqual(typeof childLogger.info, "function");
      // pino child loggers have bindings properties usually
      assert.strictEqual(childLogger.bindings().module, "TestModule");
    },
  );

  await t.test("default logger should have correct level", () => {
    assert.ok(["info", "debug", "warn", "error"].includes(logger.level));
  });
});
