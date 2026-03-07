import { prisma } from "../database/client.js";

/**
 * Graceful shutdown 핸들러를 등록한다.
 *
 * @param {Object} options
 * @param {import('./ConversationBuffer.js').ConversationBuffer} options.conversationBuffer
 * @param {import('../services/CronService.js').CronService} [options.cronService]
 * @param {import('discord.js').Client|null} [options.client] - Discord 클라이언트 (없으면 무시)
 */
export function registerShutdown({
  conversationBuffer,
  cronService = null,
  client = null,
}) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n⏳ Received ${signal}. Shutting down gracefully...`);

    // 1. CronService 중지
    if (cronService) {
      cronService.stop();
      console.log("  ✅ CronService stopped");
    }

    // 2. 대기 중인 모든 타이머 정리
    conversationBuffer.clearAll();
    console.log("  ✅ Conversation buffers cleared");

    // 3. 진행 중인 Generation들을 CANCELLED로 변경
    try {
      const result = await prisma.generation.updateMany({
        where: { status: { in: ["PROCESSING", "GENERATED"] } },
        data: { status: "CANCELLED" },
      });
      if (result.count > 0) {
        console.log(`  ✅ Cancelled ${result.count} in-progress generations`);
      }
    } catch (error) {
      console.error("  ⚠️ Failed to cancel generations:", error.message);
    }

    // 4. Discord 클라이언트 종료
    if (client) {
      try {
        client.destroy();
        console.log("  ✅ Discord client destroyed");
      } catch (error) {
        console.error("  ⚠️ Failed to destroy client:", error.message);
      }
    }

    // 5. Prisma 연결 종료
    try {
      await prisma.$disconnect();
      console.log("  ✅ Database connection closed");
    } catch (error) {
      console.error("  ⚠️ Failed to disconnect database:", error.message);
    }

    console.log("👋 Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
