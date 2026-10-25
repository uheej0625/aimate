import { fixWindowsEncoding } from "../../utils/system.js";
import { loadEnv } from "../../config/env.js";
import { createConfigManager } from "../../config/index.js";
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

let token;
try {
  token = getRequiredDiscordToken(configManager);
} catch (error) {
  logger.fatal(
    { event: "commands.deploy.failed", err: error },
    "Discord token configuration is invalid",
  );
  process.exit(1);
}

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

const rest = new REST({ version: "10" }).setToken(token);

try {
  const application = await rest.get(Routes.currentApplication());
  const clientId = application.id;

  logger.info(
    { event: "commands.deploy.started", count: commands.length },
    "Deploying Discord commands",
  );

  const guildId = process.env.DISCORD_GUILD_ID;

  let data;
  if (guildId) {
    // 길드 등록 (즉시 반영)
    data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    logger.info(
      {
        event: "commands.deploy.completed",
        guildId,
        scope: "guild",
        count: data.length,
      },
      "Discord guild commands deployed",
    );
  } else {
    // 전역 등록 (반영까지 최대 1시간 소요)
    data = await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });
    logger.info(
      {
        event: "commands.deploy.completed",
        scope: "global",
        count: data.length,
      },
      "Discord global commands deployed",
    );
  }
} catch (error) {
  logger.fatal(
    { event: "commands.deploy.failed", err: error },
    "Discord command deployment failed",
  );
  process.exit(1);
}
