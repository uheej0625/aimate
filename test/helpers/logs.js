import { Writable } from "node:stream";
import { configureLogger } from "../../src/core/logger.js";

export function captureLogs(t, level = "debug") {
  const records = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      records.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  configureLogger(
    { get: (key) => (key === "logging.level" ? level : undefined) },
    { destination },
  );
  t.after(() => {
    configureLogger();
    destination.end();
  });
  return records;
}
