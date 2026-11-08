import { createLogger } from "./logger.js";
const logger = createLogger("Shutdown");

/** Process signals belong to the host, never individual characters. */
export function registerShutdown({
  host,
  exit = (code) => process.exit(code),
}) {
  let closing;
  const shutdown = (signal) =>
    (closing ??= (async () => {
      logger.info(
        { event: "app.shutdown.started", signal },
        "Shutting down gracefully",
      );
      try {
        await host.close();
        exit(0);
      } catch (error) {
        logger.error(
          { event: "app.shutdown.failed", err: error },
          "Shutdown failed",
        );
        exit(1);
      }
    })());
  const interrupt = () => {
    void shutdown("SIGINT");
  };
  const terminate = () => {
    void shutdown("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  return () => {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  };
}
