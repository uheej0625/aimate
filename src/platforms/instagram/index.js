/**
 * Instagram 플랫폼 엔트리포인트
 *
 * Discord의 src/index.js와 동일한 추상화 레벨:
 *   1. ConfigManager 로드
 *   2. DI Container 생성
 *   3. Instagram 클라이언트 생성 & MQTT 연결
 *   4. 이벤트 핸들러 등록
 *   5. CronService 시작
 *   6. Graceful Shutdown 등록
 */
import "../../config/env.js";
import { configManager } from "../../config/index.js";
import { createContainer } from "../../core/container.js";
import { registerShutdown } from "../../core/shutdown.js";
import { createInstagramClient } from "./client.js";
import { loadEvents } from "./handlers/eventHandler.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("Instagram");

const main = async () => {
  try {
    logger.info("🚀 Starting AiMate (Instagram)...");

    const username = configManager.get("secrets.instagramUsername");
    const password = configManager.get("secrets.instagramPassword");

    if (!username || !password) {
      throw new Error(
        "Instagram credentials not configured. " +
          "Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env",
      );
    }

    // 1. Instagram 클라이언트 생성 & 로그인 & MQTT 연결
    const { ig, realtime, userId } = await createInstagramClient({
      username,
      password,
    });

    // 2. DI Container 생성 (platformClients에 instagram 등록을 위해 래핑 객체 생성)
    const instagramClient = {
      user: {
        id: userId,
        username,
        globalName: username,
        bot: true,
      },
      realtime,
      ig,
    };

    const container = createContainer(null); // Discord client는 null

    // platformClients에 Instagram 등록
    container.toolExecutor.platformClients.set("instagram", instagramClient);
    container.cronService.platformClients.set("instagram", instagramClient);

    // 3. 이벤트 핸들러 등록
    const eventContext = {
      realtime,
      userId,
      username,
      services: container,
      ig,
    };

    await loadEvents(realtime, eventContext);

    // 4. Graceful shutdown 등록
    registerShutdown({
      conversationBuffer: container.conversationBuffer,
      cronService: container.cronService,
    });

    // 5. CronService 시작
    if (container.cronService) {
      container.cronService.start();
      logger.info("⏰ CronService started");
    }

    // 6. 봇 계정 초기화 (connected 이벤트에서도 하지만 여기서도 보장)
    try {
      await container.botAccountService.initBotAccount({
        platform: "instagram",
        platformId: userId,
        handle: username,
        displayName: username,
      });
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to initialize bot platform account",
      );
    }

    logger.info("✅ Instagram bot successfully started!");
    logger.info("📨 Listening for DMs...");
  } catch (error) {
    logger.fatal({ err: error }, "❌ Failed to start Instagram bot");
    process.exit(1);
  }
};

main();
