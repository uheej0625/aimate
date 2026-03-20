import pino from "pino";
import { configManager } from "../config/index.js";

const level = configManager.get("logging.level") || "info";
const isDev = configManager.get("app.environment") === "development";

const logger = pino({
  level,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
    },
  }),
});

/**
 * 모듈별 child logger를 생성한다.
 * @param {string} module - 모듈 이름 (e.g. "ChatFlow", "CronService")
 * @returns {import('pino').Logger}
 */
export function createLogger(module) {
  return logger.child({ module });
}

export default logger;
