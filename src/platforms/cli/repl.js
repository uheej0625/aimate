import readline from "readline";
import { v4 as uuidv4 } from "uuid";
import { CLI_USER_ID } from "./constants.js";
import { adaptMessage } from "./adapter.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("CLI:REPL");

/**
 * readline REPL을 시작한다.
 * @param {{ channelId: string, mockChannel: object, mockClient: object, messageHandler: object }} options
 */
export function startRepl({
  channelId,
  mockChannel,
  mockClient,
  messageHandler,
}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  console.log("🚀 CLI Mode Started. Type your message and press Enter.");
  console.log("-----------------------------------------------------");
  rl.prompt();

  rl.on("line", async (line) => {
    const content = line.trim();
    if (!content) {
      rl.prompt();
      return;
    }

    const adapted = adaptMessage({
      id: uuidv4(),
      content,
      channelId,
      guildId: null,
      author: {
        id: CLI_USER_ID,
        username: "CLI_User",
        globalName: "CLI User",
        bot: false,
      },
      channel: mockChannel,
      client: mockClient,
    });

    try {
      await messageHandler.handle(adapted);
    } catch (error) {
      logger.error({ err: error }, "Error processing message");
      rl.prompt();
    }
  });

  rl.on("close", () => {
    console.log("\nExiting...");
    process.exit(0);
  });
}
