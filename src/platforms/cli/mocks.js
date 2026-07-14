import { v4 as uuidv4 } from "uuid";
import { adaptMessage } from "./adapter.js";

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
export function createMockChannel({ channelId, mockClient, onSend = null }) {
  const mockChannel = {
    id: channelId,
    type: 1, // DM
    platform: "cli",
    sendTyping: async () => {},
    send: async (payload) => {
      const content =
        typeof payload === "string" ? payload : (payload?.content ?? "");

      if (onSend) {
        onSend(content);
      } else {
        console.log("\n🤖 Bot:", content);
        process.stdout.write("\n> ");
      }

      return adaptMessage({
        id: uuidv4(),
        content,
        channelId,
        guildId: null,
        author: mockClient.user,
        channel: mockChannel,
        client: mockClient,
      });
    },
  };

  return mockChannel;
}
