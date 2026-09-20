import { createLogger } from "../core/logger.js";

const logger = createLogger("MessageHandler");

/** Applies platform events in receive order and schedules observed user changes. */
export class MessageHandler {
  constructor(
    messageService,
    generationLifecycle,
    conversationBuffer,
    channelRepository,
    generationAbortRegistry,
    conversationSession,
  ) {
    Object.assign(this, {
      messageService,
      generationLifecycle,
      conversationBuffer,
      channelRepository,
      generationAbortRegistry,
      conversationSession,
    });
  }

  async handle(event) {
    const { channel, botId, kind } = event;
    const session = this.conversationSession;
    const key = session.key(channel);
    const receivedAt = session.now();
    const observedAt = new Date();
    return await session.run(key, async () => {
      try {
        const observed = session.isWatching(key, receivedAt);
        const channelRecord = await this.channelRepository.findByPlatformId(
          channel.platform,
          channel.platformChannelId,
        );
        if (!channelRecord) return { changed: false };
        let changed = false;
        let shouldRespond = false;
        let deletedCount = 0;
        if (kind === "DELETE") {
          const result = await this.messageService.deleteMessages(
            channel.platform,
            event.platformMessageIds,
            channelRecord.id,
            { observed, observedAt },
          );
          deletedCount = result.deletedCount;
          changed = deletedCount > 0;
          shouldRespond =
            observed &&
            result.deletedMessages.some(
              (message) =>
                message.authorId &&
                !message.isBot &&
                message.author?.platformId !== botId,
            );
        } else if (kind === "CREATE" || kind === "UPDATE") {
          // Lazy platform hydration stays inside the receive-order queue.
          const message = event.message ?? (await event.loadMessage());
          if (message.author.isBot || message.author.platformUserId === botId)
            return { changed: false };
          if (kind === "CREATE") {
            if (!message.content.trim()) return { changed: false };
            ({ changed } = await this.messageService.saveMessage(
              message,
              null,
              [],
              { observedAt },
            ));
            shouldRespond = changed;
          } else {
            ({ changed } = await this.messageService.updateMessage(message, {
              observed,
              observedAt,
            }));
            shouldRespond = observed && changed;
          }
        } else {
          throw new Error(`Unsupported message event: ${kind}`);
        }
        if (shouldRespond) {
          const turnId = session.begin(key, receivedAt);
          this.generationAbortRegistry.abortChannel(channelRecord.id);
          try {
            await this.generationLifecycle.cancelActiveForChannel(
              channelRecord.id,
            );
            await this.conversationBuffer.add({
              channelPort: channel,
              internalChannelId: channelRecord.id,
              botId,
              turnId,
            });
          } catch (error) {
            session.settle(key, turnId);
            throw error;
          }
        }
        return { changed, deletedCount, refreshed: shouldRespond };
      } catch (error) {
        logger.error({ err: error, kind }, "Message event failed");
        throw error;
      }
    });
  }
}
