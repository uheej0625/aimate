import { randomUUID } from "node:crypto";
import { adaptIncomingMessage, adaptMessageData } from "./adapter.js";
import { CLI_BOT_ID } from "./constants.js";
import { AppEvents } from "../../core/EventBus.js";

/** CLI channel ports without terminal rendering. One review turn at a time. */
export class HeadlessChat {
  constructor({ container, mockClient, onDelivery = async () => {} }) {
    Object.assign(this, { container, mockClient, onDelivery });
    this.active = null;
    this.draining = Promise.resolve();
    this.handling = Promise.resolve();
  }

  async initialize(channels) {
    await this.container.botAccountService.initBotAccount({
      platform: "cli",
      platformId: CLI_BOT_ID,
    });
    for (const channel of channels) {
      await this.container.channelCatalog.create({
        platform: "cli",
        platformChannelId: channel.id,
        scope: "channel",
      });
    }
  }

  recover(turn) {
    return this.container.readChatTurn.execute({
      platform: "cli",
      platformMessageId: turn.messageId,
    });
  }

  async send(turn, { signal } = {}) {
    signal?.throwIfAborted();
    if (this.active) throw new Error("A headless turn is already active.");
    const { container, mockClient } = this;
    let resolveSettled;
    let rejectSettled;
    let resolveDrained;
    this.draining = new Promise((resolve) => {
      resolveDrained = resolve;
    });
    const settled = new Promise((resolve, reject) => {
      resolveSettled = resolve;
      rejectSettled = reject;
    });
    // Attach a handler immediately: cancellation may race with input storage.
    settled.catch(() => {});
    const channel = {
      platform: "cli",
      platformChannelId: turn.channelId,
      sendTyping: async () => {},
      send: async (payload) => {
        signal?.throwIfAborted();
        const message = adaptMessageData({
          id: randomUUID(),
          content: payload.content ?? "",
          channelId: turn.channelId,
          author: mockClient.user,
        });
        await this.onDelivery({
          id: message.platformMessageId,
          content: message.content,
          attachments: (payload.files ?? []).map((file) => ({
            filename: String(file.attachment).split(/[\\/]/).at(-1),
          })),
        });
        return message;
      },
    };
    const off = container.eventBus.on(AppEvents.GenerationSettled, (event) => {
      if (
        event.platform === "cli" &&
        event.platformChannelId === turn.channelId
      ) {
        resolveSettled();
        resolveDrained();
        off();
      }
    });
    const abort = () => {
      container.conversationBuffer.clear(channel);
      container.generationAbortRegistry.abortAll();
      rejectSettled(signal.reason ?? new DOMException("Stopped", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    this.active = settled;
    try {
      signal?.throwIfAborted();
      this.handling = container.messageHandler.handle(
        adaptIncomingMessage({
          id: turn.messageId,
          content: turn.userMessage,
          channelId: turn.channelId,
          author: {
            id: turn.userId,
            username: turn.userId,
            globalName: turn.userName,
            bot: false,
          },
          channel,
          client: mockClient,
        }),
      );
      const result = await this.handling;
      if (signal?.aborted) {
        container.conversationBuffer.clear(channel);
        resolveDrained();
        signal.throwIfAborted();
      }
      if (!result.changed)
        throw new Error(
          "Input was already stored; recover the turn instead of resending it.",
        );
      await settled;
      return await this.recover(turn);
    } finally {
      if (!signal?.aborted) {
        off();
        resolveDrained();
      }
      signal?.removeEventListener("abort", abort);
      this.active = null;
    }
  }

  async close() {
    this.container.generationAbortRegistry.abortAll();
    this.container.conversationBuffer.clearAll();
    await this.handling.catch(() => {});
    this.container.conversationBuffer.clearAll();
    await this.container.generationRepository.cancelInProgress();
    let timer;
    await Promise.race([
      this.draining,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
    clearTimeout(timer);
  }
}
