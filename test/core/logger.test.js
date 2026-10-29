import test from "node:test";
import assert from "node:assert";
import logger, {
  configureLogger,
  createLogger,
  withLogContext,
} from "../../src/core/logger.js";
import { captureLogs } from "../helpers/logs.js";

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

test("loggers created before configuration follow output, level and reload", (t) => {
  const early = createLogger("Early");
  const records = captureLogs(t, "warn");
  early.info("hidden");
  early.warn({ event: "test.visible" }, "visible");
  assert.deepStrictEqual(
    records.map((row) => row.event),
    ["test.visible"],
  );
  assert.strictEqual(records[0].module, "Early");

  let level = "error";
  let reload;
  const manager = {
    get: (key) => (key === "logging.level" ? level : undefined),
    onChange: (callback) => {
      reload = callback;
    },
  };
  configureLogger(manager);
  assert.strictEqual(early.level, "error");
  level = "debug";
  reload();
  assert.strictEqual(early.level, "debug");
});

test("async log context isolates concurrent turns and restores nested scope", async (t) => {
  const records = captureLogs(t);
  const child = createLogger("Concurrent");
  await Promise.all(
    ["a", "b"].map((id) =>
      withLogContext({ channelId: id, generationId: id }, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        await withLogContext(
          { generationId: `image-${id}`, parentGenerationId: id },
          async () => {
            await new Promise((resolve) => setImmediate(resolve));
            child.info({ event: "test.image" });
          },
        );
        child.info({ event: "test.chat" });
      }),
    ),
  );
  child.info({ event: "test.outside" });
  for (const id of ["a", "b"]) {
    const rows = records.filter((row) => row.channelId === id);
    assert.strictEqual(
      rows.find((row) => row.event === "test.image").generationId,
      `image-${id}`,
    );
    assert.strictEqual(
      rows.find((row) => row.event === "test.chat").generationId,
      id,
    );
    assert.ok(
      !Object.hasOwn(
        rows.find((row) => row.event === "test.chat"),
        "parentGenerationId",
      ),
    );
  }
  assert.ok(!Object.hasOwn(records.at(-1), "channelId"));
});

test("error serialization excludes provider payloads and redacts known secret fields", (t) => {
  const records = captureLogs(t);
  const cause = Object.assign(new Error("upstream unavailable"), {
    request: { body: "PRIVATE_REQUEST" },
    responseBody: "PRIVATE_RESPONSE",
    headers: { authorization: "PRIVATE_AUTH" },
    statusCode: 503,
  });
  const error = Object.assign(new Error("generation failed", { cause }), {
    requestBodyValues: { system: "PRIVATE_PROMPT" },
    token: "PRIVATE_TOKEN",
    code: "UPSTREAM",
  });
  logger.error({
    err: error,
    secrets: { apiKey: "PRIVATE_KEY" },
    credentials: { vertexPrivateKey: "PRIVATE_KEY" },
    apiKey: "PRIVATE_KEY",
  });
  const row = records[0];
  assert.strictEqual(row.err.code, "UPSTREAM");
  assert.strictEqual(row.err.cause.statusCode, 503);
  assert.match(row.err.stack, /generation failed/);
  assert.doesNotMatch(JSON.stringify(row), /PRIVATE_/);
  const retry = Object.assign(new Error("Retries exhausted"), {
    name: "AI_RetryError",
    reason: "maxRetriesExceeded",
    lastError: cause,
    errors: [cause, cause],
  });
  logger.error({ err: retry });
  assert.strictEqual(records[1].err.attemptCount, 2);
  assert.strictEqual(records[1].err.cause.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_/);
});
