import { Events } from "discord.js";
import { createLogger } from "../../../core/logger.js";

const logger = createLogger("Discord:Ready");

/**
 * Ready 이벤트
 * 봇이 Discord에 성공적으로 로그인했을 때 실행
 */
export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(
      {
        event: "platform.ready",
        platformUserId: client.user.id,
        guilds: client.guilds.cache.size,
        users: client.users.cache.size,
      },
      "Bot is online and ready",
    );
  },
};
