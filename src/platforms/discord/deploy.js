import { fixWindowsEncoding } from "../../utils/system.js";
import { loadEnv } from "../../config/env.js";
import {
  createConfigManager,
  createCharacterConfigManager,
} from "../../config/index.js";
import { configureLogger } from "../../core/logger.js";

fixWindowsEncoding();
loadEnv();

const configManager = createConfigManager({ watch: false });
configureLogger(configManager);

const { REST, Routes } = await import("discord.js");
const { getRequiredDiscordToken } = await import("./credentials.js");
const { readdirSync } = await import("fs");
const { join, dirname } = await import("path");
const { fileURLToPath } = await import("url");
const { createLogger } = await import("../../core/logger.js");

const logger = createLogger("Deploy");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 커맨드 파일 로드
const commandsPath = join(__dirname, "commands");
const commandFiles = readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

const commands = [];
for (const file of commandFiles) {
  const mod = await import(`file://${join(commandsPath, file)}`);
  const command = mod.default || mod;
  if (command?.data) {
    commands.push(command.data);
    logger.debug(
      { event: "commands.deploy.selected", commandName: command.data.name },
      "Command selected for deployment",
    );
  }
}

const { getCharacterDefinitions } = await import("../../config/characters.js");
const { selectedDefinitions, readCharacterOption } = await import(
  "../../config/selection.js"
);
let failed = false;
try {
  for (const { id } of selectedDefinitions(
    getCharacterDefinitions(configManager),
    { platform: "discord", characterId: readCharacterOption() },
  )) {
    const settings = createCharacterConfigManager({
      characterId: id,
      watch: false,
      source: configManager,
    });
    try {
      const rest = new REST({ version: "10" }).setToken(
        getRequiredDiscordToken(settings),
      );
      const application = await rest.get(Routes.currentApplication());
      const guildId = process.env.DISCORD_GUILD_ID;
      await rest.put(
        guildId
          ? Routes.applicationGuildCommands(application.id, guildId)
          : Routes.applicationCommands(application.id),
        { body: commands },
      );
      logger.info(
        {
          event: "commands.deploy.completed",
          characterId: id,
          guildId,
          count: commands.length,
        },
        "Discord commands deployed",
      );
    } catch (error) {
      failed = true;
      logger.error(
        { event: "commands.deploy.failed", characterId: id, err: error },
        "Discord command deployment failed",
      );
    } finally {
      settings.close();
    }
  }
} catch (error) {
  failed = true;
  logger.error(
    { event: "commands.deploy.failed", err: error },
    "Invalid deployment selection",
  );
} finally {
  configManager.close();
}
if (failed) process.exitCode = 1;
