import { fixWindowsEncoding } from "./utils/system.js";
import { loadEnv } from "./config/env.js";
import {
  createConfigManager,
  createCharacterConfigManager,
} from "./config/index.js";
import { getCharacterDefinitions } from "./config/characters.js";
import {
  readCharacterOption,
  selectedDefinitions,
} from "./config/selection.js";
import { ConfigurationError } from "./config/ConfigurationError.js";
import { createHost } from "./core/host.js";
import { registerShutdown } from "./core/shutdown.js";
import { configureLogger, createLogger } from "./core/logger.js";
import { prisma } from "./database/client.js";
import { createDiscordConnection } from "./platforms/discord/createDiscordApplication.js";
import { createCliConnection } from "./platforms/cli/connection.js";

fixWindowsEncoding();
loadEnv();
const logger = createLogger("App");

export async function main({ cli = false } = {}) {
  let host, configManager;
  try {
    configManager = createConfigManager();
    configureLogger(configManager);
    const definitions = getCharacterDefinitions(configManager);
    const characterId = readCharacterOption();
    const selected = cli
      ? selectedDefinitions(definitions, {
          platform: "cli",
          characterId: characterId ?? configManager.get("character"),
        })
      : selectedDefinitions(definitions, { platform: "discord", characterId });
    if (cli && selected.length !== 1)
      throw new ConfigurationError("CLI requires one --character selection.");
    await prisma.$connect();
    host = createHost({
      definitions: selected,
      createCharacter: async ({ id }) => {
        const settings = createCharacterConfigManager({
          characterId: id,
          source: configManager,
        });
        const connections = [];
        if (settings.get("connections.discord"))
          connections.push(
            createDiscordConnection({ configManager: settings }),
          );
        if (cli)
          connections.push(createCliConnection({ configManager: settings }));
        return { configManager: settings, connections };
      },
      disconnectDatabase: async () => {
        await configManager.close();
        await prisma.$disconnect();
      },
    });
    registerShutdown({ host });
    await host.start();
    return host;
  } catch (error) {
    if (host) await host.close();
    else {
      await configManager?.close();
      await prisma.$disconnect();
    }
    const exitCode = error instanceof ConfigurationError ? 78 : 1;
    logger.fatal(
      { event: "app.start.failed", err: error, exitCode },
      "Failed to start bot",
    );
    if (cli && process.stdout.isTTY)
      process.stderr.write(`AiMate 시작 실패: ${error.message}\n`);
    process.exit(exitCode);
  }
}
