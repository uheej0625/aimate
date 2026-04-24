import os from "os";
import { execSync } from "child_process";

// Windows 환경에서 터미널의 코드 페이지를 UTF-8로 변경 (로그 한글 깨짐 방지용)
if (os.platform() === "win32") {
  try {
    execSync("chcp 65001", { stdio: "ignore" });
  } catch (e) {}
}

import { configManager } from "../../config/index.js";
import client from "./client.js";
import { loadEvents } from "./handlers/eventHandler.js";
import { loadCommands } from "./handlers/commandHandler.js";
import { createContainer } from "../../core/container.js";
import { registerShutdown } from "../../core/shutdown.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("App");

const main = async () => {
  try {
    logger.info("Starting AiMate");

    // Initialize DI Container
    const container = await createContainer(client);

    // Attach services to client for access in events
    client.services = container;

    // Register graceful shutdown
    registerShutdown({
      conversationBuffer: container.conversationBuffer,
      cronService: container.cronService,
      client,
    });

    // Load Events
    await loadEvents(client);

    // Load Commands
    await loadCommands(client);

    // Start CronService
    if (container.cronService) {
      container.cronService.start();
    }

    // Login
    await client.login(configManager.get("secrets.discordToken"));
  } catch (error) {
    logger.fatal({ err: error }, "Failed to start bot");
    process.exit(1);
  }
};

main();
