import { fixWindowsEncoding } from "../../utils/system.js";
import { loadEnv } from "../../config/env.js";
import { createConfigManager } from "../../config/index.js";
import { configureLogger } from "../../core/logger.js";

fixWindowsEncoding();
loadEnv();

const configManager = createConfigManager();
configureLogger(configManager);

const { v4: uuidv4 } = await import("uuid");
const { createContainer } = await import("../../core/container.js");
const { registerShutdown } = await import("../../core/shutdown.js");
const { CLI_BOT_ID } = await import("./constants.js");
const { createMockClient, createMockChannel } = await import("./mocks.js");
const { startRepl } = await import("./repl.js");
const { createLogger } = await import("../../core/logger.js");

const logger = createLogger("CLI");

(async () => {
  const CLI_CHANNEL_ID = uuidv4();

  logger.info("🔧 Initializing CLI Mode...");
  logger.info({ channelId: CLI_CHANNEL_ID }, "📱 Channel ID");

  const container = await createContainer({ configManager });
  const { messageHandler, botAccountService } = container;

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

  const mockClient = createMockClient({ botId: CLI_BOT_ID });
  const mockChannel = createMockChannel({
    channelId: CLI_CHANNEL_ID,
    mockClient,
  });

  startRepl({
    channelId: CLI_CHANNEL_ID,
    mockChannel,
    mockClient,
    messageHandler,
  });
})();
