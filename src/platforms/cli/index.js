import { fixWindowsEncoding } from "../../utils/system.js";
import { loadEnv } from "../../config/env.js";
import { createConfigManager } from "../../config/index.js";
import { configureLogger } from "../../core/logger.js";

fixWindowsEncoding();
loadEnv();

const configManager = createConfigManager();
configureLogger(configManager);

const { createContainer } = await import("../../core/container.js");
const { registerShutdown } = await import("../../core/shutdown.js");
const { CLI_BOT_ID } = await import("./constants.js");
const { createMockClient } = await import("./mocks.js");
const { startRepl } = await import("./repl.js");
const { createLogger } = await import("../../core/logger.js");

const logger = createLogger("CLI");

(async () => {
  logger.info("🔧 Initializing CLI Mode...");

  const mockClient = createMockClient({ botId: CLI_BOT_ID });
  const platformClients = new Map([["cli", mockClient]]);
  const container = await createContainer({ configManager, platformClients });
  const {
    messageHandler,
    botAccountService,
    channelRepository,
    messageRepository,
  } = container;

  // Register graceful shutdown
  registerShutdown({
    conversationBuffer: container.conversationBuffer,
    configManager,
  });

  logger.info("🤖 Initializing bot platform account...");
  try {
    await botAccountService.initBotAccount({
      platform: "cli",
      platformId: CLI_BOT_ID,
    });
  } catch (error) {
    logger.fatal(
      { err: error },
      "❌ Failed to initialize bot platform account",
    );
    process.exit(1);
  }

  await startRepl({
    channelRepository,
    messageRepository,
    messageHandler,
    mockClient,
  });
})();
