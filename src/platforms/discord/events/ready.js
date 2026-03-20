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
        tag: client.user.tag,
        guilds: client.guilds.cache.size,
        users: client.users.cache.size,
      },
      "Bot is online and ready",
    );

    // Initialize bot's platform account
    try {
      const { botAccountService } = client.services;
      const { account, created } = await botAccountService.initBotAccount({
        platform: "discord",
        platformId: client.user.id,
        handle: client.user.username,
        displayName: client.user.globalName,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize bot platform account");
    }

    // 봇 상태 설정
    client.user.setPresence({
      activities: [{ name: "Discord", type: 0 }],
      status: "online",
    });
  },
};
