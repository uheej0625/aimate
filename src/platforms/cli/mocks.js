import { v4 as uuidv4 } from "uuid";
import { adaptMessageData } from "./adapter.js";

/**
 * @param {{ botId: string, username?: string, globalName?: string }} options
 */
export function createMockClient({
  botId,
  username = "DiscordMate_Bot",
  globalName = "DiscordMate Bot",
}) {
  return {
    user: {
      id: botId,
      username,
      globalName,
      bot: true,
    },
  };
}

/**
 * @param {{ channelId: string, mockClient: object, onSend?: (content: string) => void }} options
 */
export function createMockChannel({
  channelId,
  mockClient,
  onSend = null,
  onTyping = null,
}) {
  const mockChannel = {
    platform: "cli",
    platformChannelId: channelId,
    sendTyping: async () => onTyping?.(),
    send: async (payload) => {
      const content =
        typeof payload === "string" ? payload : (payload?.content ?? "");

      if (onSend) {
        onSend(content);
      } else {
        console.log("\n🤖 Bot:", content);
        process.stdout.write("\n> ");
      }

      return adaptMessageData({
        id: uuidv4(),
        content,
        channelId,
        guildId: null,
        author: mockClient.user,
      });
    },
  };

  return mockChannel;
}
