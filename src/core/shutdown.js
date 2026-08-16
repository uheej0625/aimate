import { prisma } from "../database/client.js";
import { createLogger } from "./logger.js";

const logger = createLogger("Shutdown");

/**
 * Graceful shutdown 핸들러를 등록한다.
 *
 * @param {Object} options
 * @param {import('../chat/ConversationBuffer.js').ConversationBuffer} options.conversationBuffer
 * @param {import('../scheduling/CronJobWorker.js').CronJobWorker} [options.cronJobWorker]
 * @param {import('../chat/ChatGenerationAbortRegistry.js').ChatGenerationAbortRegistry} [options.generationAbortRegistry]
 * @param {import('../config/ConfigManager.js').default} [options.configManager]
 * @param {import('discord.js').Client|null} [options.client] - Discord 클라이언트 (없으면 무시)
 */
export function registerShutdown({
  conversationBuffer,
  cronJobWorker = null,
  generationAbortRegistry = null,
  configManager = null,
  client = null,
}) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Shutting down gracefully...");

    // 1. CronJobWorker 중지
    if (cronJobWorker) {
      cronJobWorker.stop();
      logger.info("CronJobWorker stopped");
    }

    // 2. 대기 중인 모든 타이머 정리
    conversationBuffer.clearAll();
    logger.info("Conversation buffers cleared");

    // 3. 진행 중인 모델 요청 abort
    if (generationAbortRegistry) {
      const aborted = generationAbortRegistry.abortAll();
      if (aborted > 0) {
        logger.info({ count: aborted }, "Aborted in-flight model requests");
      }
    }

    // 4. 진행 중인 Generation들을 CANCELLED로 변경
    try {
      const result = await prisma.generation.updateMany({
        where: { status: { in: ["PROCESSING", "GENERATED"] } },
        data: { status: "CANCELLED" },
      });
      if (result.count > 0) {
        logger.info(
          { count: result.count },
          "Cancelled in-progress generations",
        );
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to cancel generations");
    }

    // 5. Discord 클라이언트 종료
    if (client) {
      try {
        client.destroy();
        logger.info("Discord client destroyed");
      } catch (error) {
        logger.error({ err: error }, "Failed to destroy client");
      }
    }

    // 6. Config watcher 종료
    if (configManager) {
      configManager.close();
      logger.info("Config watcher closed");
    }

    // 7. Prisma 연결 종료
    try {
      await prisma.$disconnect();
      logger.info("Database connection closed");
    } catch (error) {
      logger.error({ err: error }, "Failed to disconnect database");
    }

    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
