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
const { createDiscordApplication } = await import(
  "./createDiscordApplication.js"
);
const { registerShutdown } = await import("../../core/shutdown.js");
const { createLogger } = await import("../../core/logger.js");

const logger = createLogger("App");

const main = async () => {
  try {
    logger.info("Starting AiMate");

    const app = await createDiscordApplication({ configManager, client });

    // Register graceful shutdown
    registerShutdown({
      conversationBuffer: app.conversationBuffer,
      cronJobWorker: app.cronJobWorker,
      configManager,
      client,
    });

    // Start CronJobWorker
    app.cronJobWorker.start();

    // Login
    await client.login(getRequiredDiscordToken(configManager));
  } catch (error) {
    logger.fatal({ err: error }, "Failed to start bot");
    process.exit(1);
  }
};

main();
