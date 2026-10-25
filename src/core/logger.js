import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";

const context = new AsyncLocalStorage();
const configuredManagers = new WeakSet();

export function withLogContext(fields, operation) {
  return context.run({ ...context.getStore(), ...fields }, operation);
}

export function elapsedMs(startedAt) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

// Provider/Discord errors can carry credentials and entire request/response bodies.
function serializeError(error, depth = 0) {
  if (error == null) return error;
  const result = {
    type: error.name ?? "Error",
    message: typeof error === "string" ? error : error.message,
    stack: error.stack,
    code: error.code,
    statusCode: error.statusCode ?? error.status,
    isRetryable:
      typeof error.isRetryable === "boolean" ? error.isRetryable : undefined,
  };
  if (error.name === "AI_RetryError") {
    result.reason = error.reason;
    result.attemptCount = error.errors?.length;
  }
  const cause = error.cause ?? error.lastError;
  if (cause && depth < 3) result.cause = serializeError(cause, depth + 1);
  return result;
}

function createRootLogger({ level = "info", isDev = false, destination } = {}) {
  const isTest =
    process.env.NODE_ENV === "test" || !!process.env.NODE_TEST_CONTEXT;
  const isInteractiveCli =
    process.env.PLATFORM === "cli" && process.stdout.isTTY;
  return pino(
    {
      level: isInteractiveCli ? "silent" : level,
      timestamp: pino.stdTimeFunctions.isoTime,
      mixin: () => ({ ...context.getStore() }),
      serializers: { err: (error) => serializeError(error) },
      redact: {
        paths: [
          "secrets",
          "authorization",
          "apiKey",
          "token",
          "password",
          "privateKey",
          "headers",
          "*.authorization",
          "*.apiKey",
          "*.token",
          "*.password",
          "*.privateKey",
          "*.headers",
        ],
        censor: "[REDACTED]",
      },
      ...(isDev &&
        !isTest &&
        !destination && {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
          },
        }),
    },
    destination,
  );
}

let rootLogger = createRootLogger();

export function configureLogger(configManager, { destination } = {}) {
  rootLogger = createRootLogger({
    level: configManager?.get("logging.level") || "info",
    isDev: configManager?.get("app.environment") === "development",
    destination,
  });
  if (configManager?.onChange && !configuredManagers.has(configManager)) {
    configuredManagers.add(configManager);
    configManager.onChange(() => {
      if (!(process.env.PLATFORM === "cli" && process.stdout.isTTY)) {
        rootLogger.level = configManager.get("logging.level") || "info";
      }
    });
  }
  return logger;
}

// Early imports must follow the configured root, including its output and level.
function liveLogger(bindings) {
  let root;
  let child;
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (root !== rootLogger) {
          root = rootLogger;
          child = root.child(bindings);
        }
        if (property === "child")
          return (fields) => liveLogger({ ...bindings, ...fields });
        const value = child[property];
        return typeof value === "function" ? value.bind(child) : value;
      },
    },
  );
}

export function createLogger(module) {
  return liveLogger({ module });
}

const logger = liveLogger({});
export default logger;
