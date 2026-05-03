import "../../config/env.js";
import { v4 as uuidv4 } from "uuid";
import { createContainer } from "../../core/container.js";
import { registerShutdown } from "../../core/shutdown.js";
import { CLI_BOT_ID } from "./constants.js";
import { createMockClient, createMockChannel } from "./mocks.js";
import { startRepl } from "./repl.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("CLI");

(async () => {
  const CLI_CHANNEL_ID = uuidv4();

  logger.info("🔧 Initializing CLI Mode...");
  logger.info({ channelId: CLI_CHANNEL_ID }, "📱 Channel ID");

  const container = await createContainer();
  const { messageHandler, botAccountService } = container;

  // Register graceful shutdown
  registerShutdown({
    conversationBuffer: container.conversationBuffer,
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
