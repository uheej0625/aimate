import { fixWindowsEncoding } from "../../utils/system.js";
import { loadEnv } from "../../config/env.js";
import { createConfigManager } from "../../config/index.js";
import { configureLogger } from "../../core/logger.js";

fixWindowsEncoding();
loadEnv();

const configManager = createConfigManager();
configureLogger(configManager);

const { default: client } = await import("./client.js");
const { getRequiredDiscordToken } = await import("./credentials.js");
const { loadEvents } = await import("./handlers/eventHandler.js");
const { loadCommands } = await import("./handlers/commandHandler.js");
const { createContainer } = await import("../../core/container.js");
const { registerShutdown } = await import("../../core/shutdown.js");
const { createLogger } = await import("../../core/logger.js");

const logger = createLogger("App");

const main = async () => {
  try {
    logger.info("Starting AiMate");

    // Initialize DI Container
    const container = await createContainer({ configManager, client });

    // Attach services to client for access in events
    client.services = container;

    // Register graceful shutdown
    registerShutdown({
      conversationBuffer: container.conversationBuffer,
      cronJobWorker: container.cronJobWorker,
      configManager,
      client,
    });

    // Load Events
    await loadEvents(client);

    // Load Commands
    await loadCommands(client);

    // Start CronJobWorker
    if (container.cronJobWorker) {
      container.cronJobWorker.start();
    }

    // Login
    await client.login(getRequiredDiscordToken(configManager));
  } catch (error) {
    logger.fatal({ err: error }, "Failed to start bot");
    process.exit(1);
  }
};

main();
