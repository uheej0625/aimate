import { Events } from "discord.js";

/**
 * Ready 이벤트
 * 봇이 Discord에 성공적으로 로그인했을 때 실행
 */
export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
    console.log(`👥 Watching ${client.users.cache.size} users`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

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
      console.error("Failed to initialize bot platform account:", error);
    }

    // 봇 상태 설정
    client.user.setPresence({
      activities: [{ name: "Discord", type: 0 }],
      status: "online",
    });
  },
};
