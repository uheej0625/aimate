import pino from "pino";

function isTestRuntime() {
  return (
    process.env.NODE_ENV === "test" ||
    process.argv.some((arg) => arg.includes("--test")) ||
    process.execArgv.some((arg) => arg.includes("--test")) ||
    !!process.env.NODE_TEST_CONTEXT
  );
}

function createRootLogger({ level = "info", isDev = false } = {}) {
  const isTest = isTestRuntime();
  const isInteractiveCli =
    process.env.PLATFORM === "cli" && process.stdout.isTTY;

  return pino({
    level: isInteractiveCli ? "silent" : level,
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev &&
      !isTest && {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
        },
      }),
  });
}

let logger = createRootLogger();

export function configureLogger(configManager) {
  logger = createRootLogger({
    level: configManager?.get("logging.level") || "info",
    isDev: configManager?.get("app.environment") === "development",
  });

  return logger;
}

/**
 * 모듈별 child logger를 생성한다.
 * @param {string} module - 모듈 이름 (e.g. "ChatFlow", "CronService")
 * @returns {import('pino').Logger}
 */
export function createLogger(module) {
  return logger.child({ module });
}

export { logger as default };
