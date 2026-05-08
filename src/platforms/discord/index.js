import os from "os";

import { fixWindowsEncoding } from "../../utils/system.js";
fixWindowsEncoding();

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
