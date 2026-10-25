import { Client, GatewayIntentBits, Collection, Partials } from "discord.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("DiscordClient");

// Discord 클라이언트 생성
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// 명령어 컬렉션 초기화
client.commands = new Collection();

// 에러 처리
client.on("error", (error) => {
  logger.error(
    { event: "platform.client.failed", platform: "discord", err: error },
    "Discord client error",
  );
});

process.on("unhandledRejection", (error) => {
  logger.error(
    { event: "process.unhandled_rejection", err: error },
    "Unhandled promise rejection",
  );
});

export default client;
