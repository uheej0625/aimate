import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createLogger } from "../../../core/logger.js";

const logger = createLogger("Discord:CommandHandler");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadCommands(client) {
  const commandsPath = join(__dirname, "..", "commands");
  const commandFiles = readdirSync(commandsPath).filter((file) =>
    file.endsWith(".js"),
  );

  for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const command = await import(`file://${filePath}`);
    const commandModule = command.default || command;

    if ("data" in commandModule && "execute" in commandModule) {
      client.commands.set(commandModule.data.name, commandModule);
    } else {
      logger.warn(
        { file },
        'Skipped: missing required "data" or "execute" property',
      );
    }
  }

  logger.info({ count: client.commands.size }, "Commands loaded");
}
