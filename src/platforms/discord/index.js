import { fixWindowsEncoding } from "../../utils/system.js";
import { loadEnv } from "../../config/env.js";
import { createConfigManager } from "../../config/index.js";
import { ConfigurationError } from "../../config/ConfigurationError.js";
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
const { prisma } = await import("../../database/client.js");
const { createLogger } = await import("../../core/logger.js");

const logger = createLogger("App");

const main = async () => {
  try {
    logger.info("Starting AiMate");

    const app = await createDiscordApplication({ configManager, client });

    // Register graceful shutdown
    registerShutdown({
      conversationBuffer: app.conversationBuffer,
      generationAbortRegistry: app.generationAbortRegistry,
      generationRepository: app.generationRepository,
      configManager,
      client,
      disconnectDatabase: () => prisma.$disconnect(),
    });

    // Login
    await client.login(getRequiredDiscordToken(configManager));
  } catch (error) {
    const exitCode = error instanceof ConfigurationError ? 78 : 1;
    logger.fatal({ err: error, exitCode }, "Failed to start bot");
    process.exit(exitCode);
  }
};

main();
