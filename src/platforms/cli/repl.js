import { v4 as uuidv4 } from "uuid";
import { CLI_BOT_ID, CLI_USER_ID } from "./constants.js";
import { adaptIncomingMessage } from "./adapter.js";
import { createMockChannel } from "./mocks.js";
import { ChatTui } from "./tui.js";

function toViewMessage(record) {
  return {
    id: record.id,
    role: record.authorPlatformId === CLI_BOT_ID ? "assistant" : "user",
    content: record.content,
    createdAt: record.createdAt,
  };
}

function makeTitle(messages) {
  const source = messages.find((message) => message.role === "user")?.content;
  return source ? source.replace(/\s+/g, " ").slice(0, 32) : "새 채팅";
}

/** Start the persistent multi-channel terminal UI. */
export async function startRepl({
  channelCatalog,
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

  const toViewChannel = (record) => {
    const messages = record.messages.map(toViewMessage);
    makeChannelObject(record.id);
    return {
      id: record.id,
      title: makeTitle(messages),
      messages,
      messageCount: record.messageCount,
      updatedAt: record.updatedAt,
    };
  };

  let records = await channelCatalog.list({ platform: "cli" });
  if (!records.length) {
    records = [
      await channelCatalog.create({
        platform: "cli",
        platformChannelId: uuidv4(),
        scope: "channel",
      }),
    ];
  }
  const channels = records.map(toViewChannel);
  tui.start(channels);

  tui.on("new-channel", () => {
    void (async () => {
      try {
        const id = uuidv4();
        const channel = await channelCatalog.create({
          platform: "cli",
          platformChannelId: id,
          scope: "channel",
        });
        makeChannelObject(id);
        tui.addChannel({
          id: channel.id,
          title: "새 채팅",
          messages: channel.messages,
          messageCount: channel.messageCount,
          updatedAt: channel.updatedAt,
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
