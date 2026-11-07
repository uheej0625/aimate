import { fixWindowsEncoding } from "../../utils/system.js";
import { loadEnv } from "../../config/env.js";
import { createCharacterConfigManager } from "../../config/index.js";
import { ConfigurationError } from "../../config/ConfigurationError.js";
import { configureLogger } from "../../core/logger.js";

fixWindowsEncoding();
loadEnv();

const configManager = createCharacterConfigManager();
configureLogger(configManager);

const { createContainer } = await import("../../core/container.js");
const { registerShutdown } = await import("../../core/shutdown.js");
const { prisma } = await import("../../database/client.js");
const { getCliBotId } = await import("./constants.js");
const { createMockClient } = await import("./mocks.js");
const { startRepl } = await import("./repl.js");
const { createLogger } = await import("../../core/logger.js");

const logger = createLogger("CLI");

(async () => {
  logger.info({ event: "app.starting", platform: "cli" }, "Starting CLI");

  if (!configManager.get("connections.cli")) {
    throw new ConfigurationError(
      "The selected character has no CLI connection.",
    );
  }
  const botId = getCliBotId(configManager.get("character"));
  const mockClient = createMockClient({ botId });
  const platformClients = new Map([["cli", mockClient]]);
  const container = await createContainer({ configManager, platformClients });
  const {
    messageHandler,
    botAccountService,
    channelCatalog,
    generationRepository,
    generationAbortRegistry,
  } = container;

  // Register graceful shutdown
  registerShutdown({
    conversationBuffer: container.conversationBuffer,
    generationAbortRegistry,
    generationRepository,
    configManager,
    disconnectDatabase: () => prisma.$disconnect(),
  });

  logger.debug(
    { event: "bot_account.init.started" },
    "Initializing bot platform account",
  );
  try {
    await botAccountService.initBotAccount({
      platform: "cli",
      platformId: botId,
    });
  } catch (error) {
    logger.fatal(
      { event: "bot_account.init.failed", err: error },
      "❌ Failed to initialize bot platform account",
    );
    process.exit(1);
  }

  await startRepl({
    channelCatalog,
    messageHandler,
    mockClient,
  });
})();
