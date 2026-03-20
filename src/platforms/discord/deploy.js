import { REST, Routes } from "discord.js";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { configManager } from "../../config/index.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("Deploy");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const token = configManager.get("secrets.discordToken");
const clientId = configManager.get("secrets.discordClientId");

if (!token) {
  logger.fatal(
    "DISCORD_TOKEN이 설정되지 않았습니다. .env 또는 config/default.json을 확인하세요.",
  );
  process.exit(1);
}
if (!clientId) {
  logger.fatal(
    "DISCORD_CLIENT_ID가 설정되지 않았습니다. .env 또는 config/default.json의 secrets.discordClientId를 채워주세요.",
  );
  logger.info(
    "   Discord Developer Portal → 앱 선택 → General Information → Application ID",
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
    logger.info({ command: command.data.name }, "📌 등록 예정");
  }
}

const rest = new REST({ version: "10" }).setToken(token);

try {
  logger.info({ count: commands.length }, "🚀 Discord에 커맨드 등록 시작...");

  const guildId = process.env.DISCORD_GUILD_ID;

  let data;
  if (guildId) {
    // 길드 등록 (즉시 반영)
    data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    logger.info(
      { guildId, count: data.length },
      "✅ 길드에 커맨드를 즉시 등록했습니다.",
    );
  } else {
    // 전역 등록 (반영까지 최대 1시간 소요)
    data = await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });
    logger.info({ count: data.length }, "✅ 커맨드를 전역 등록했습니다.");
    logger.info("⏳ 전역 커맨드 반영까지 최대 1시간이 걸릴 수 있습니다.");
    logger.info(
      "   즉시 테스트하려면 DISCORD_GUILD_ID를 .env에 추가한 후 다시 실행하세요.",
    );
  }
} catch (error) {
  logger.fatal({ err: error }, "❌ 커맨드 등록 중 오류");
  process.exit(1);
}
