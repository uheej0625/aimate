import { v4 as uuidv4 } from "uuid";
import { CLI_BOT_ID, CLI_USER_ID } from "./constants.js";
import { adaptIncomingMessage } from "./adapter.js";
import { createMockChannel } from "./mocks.js";
import { ChatTui } from "./tui.js";

function toViewMessage(record) {
  return {
    id: record.platformId,
    role: record.author.platformId === CLI_BOT_ID ? "assistant" : "user",
    content: record.content,
    createdAt: record.createdAt,
  };
}

function makeTitle(messages) {
  const source = messages.find((message) => message.role === "user")?.content;
  return source ? source.replace(/\s+/g, " ").slice(0, 32) : "새 채팅";
}

/** Start the persistent multi-conversation terminal UI. */
export async function startRepl({
  channelRepository,
  messageRepository,
  messageHandler,
  mockClient,
  onQuit = null,
}) {
  const tui = new ChatTui();
  const channelObjects = new Map();

  const makeChannelObject = (channelId) => {
    if (channelObjects.has(channelId)) return channelObjects.get(channelId);
    const channel = createMockChannel({
      channelId,
      mockClient,
      onTyping: () => tui.setBusy(channelId, true),
      onSend: (content) => {
        tui.addMessage(channelId, {
          id: uuidv4(),
          role: "assistant",
          content,
          createdAt: new Date(),
        });
        tui.setBusy(channelId, false);
      },
    });
    channelObjects.set(channelId, channel);
    return channel;
  };

  const loadChannel = async (record) => {
    const records = await messageRepository.getHistoryByPlatformChannelId(
      "cli",
      record.platformId,
      100,
    );
    const messages = records.map(toViewMessage);
    makeChannelObject(record.platformId);
    return {
      id: record.platformId,
      title: makeTitle(messages),
      messages,
      messageCount: record._count?.messages ?? messages.length,
      updatedAt: record.updatedAt,
    };
  };

  let records = await channelRepository.listByPlatform("cli");
  if (!records.length) {
    records = [
      await channelRepository.upsert({
        platform: "cli",
        platformId: uuidv4(),
        scope: "channel",
      }),
    ];
  }
  const channels = await Promise.all(records.map(loadChannel));
  tui.start(channels);

  tui.on("new-channel", () => {
    void (async () => {
      try {
        const id = uuidv4();
        await channelRepository.upsert({
          platform: "cli",
          platformId: id,
          scope: "channel",
        });
        makeChannelObject(id);
        tui.addChannel({
          id,
          title: "새 채팅",
          messages: [],
          messageCount: 0,
          updatedAt: new Date(),
        });
      } catch {
        tui.setNotice("새 채팅을 만들지 못했습니다", "error");
      }
    })();
  });

  tui.on("send", ({ channelId, content }) => {
    void (async () => {
      const channel = makeChannelObject(channelId);
      const message = {
        id: uuidv4(),
        content,
        channelId,
        guildId: null,
        author: {
          id: CLI_USER_ID,
          username: "CLI_User",
          globalName: "CLI User",
          bot: false,
        },
        channel,
        client: mockClient,
      };
      tui.addMessage(channelId, {
        id: message.id,
        role: "user",
        content,
        createdAt: new Date(),
      });
      tui.setBusy(channelId, true);
      try {
        await messageHandler.handle(adaptIncomingMessage(message));
      } catch {
        tui.setBusy(channelId, false);
        tui.setNotice("메시지를 처리하지 못했습니다", "error");
      }
    })();
  });

  tui.on("quit", () => {
    if (onQuit) onQuit();
    else process.kill(process.pid, "SIGINT");
  });

  return tui;
}
