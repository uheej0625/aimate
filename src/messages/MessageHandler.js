import { createLogger, elapsedMs, withLogContext } from "../core/logger.js";

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

  handle(event) {
    return withLogContext(
      {
        platform: event.channel.platform,
        platformChannelId: event.channel.platformChannelId,
        messageKind: event.kind,
        platformMessageId: event.message?.platformMessageId,
      },
      () => this.handleEvent(event),
    );
  }

  async handleEvent(event) {
    const { channel, botId, kind } = event;
    const session = this.conversationSession;
    const key = session.key(channel);
    const receivedAt = session.now();
    const observedAt = new Date();
    const startedAt = performance.now();
    let channelId;
    let platformMessageId = event.message?.platformMessageId;
    logger.debug(
      {
        event: "message.received",
        messageCount: event.platformMessageIds?.length ?? 1,
      },
      "Message event received",
    );
    return await session.run(key, async () => {
      logger.debug(
        { event: "message.processing", queueWaitMs: elapsedMs(startedAt) },
        "Message event dequeued",
      );
      try {
        const observed = session.isWatching(key, receivedAt);
        const channelRecord = await this.channelRepository.findByPlatformId(
          channel.platform,
          channel.platformChannelId,
        );
        if (!channelRecord) {
          logger.debug(
            { event: "message.skipped", reason: "unregistered_channel" },
            "Message event skipped",
          );
          return { changed: false };
        }
        if (channelRecord.logEnabled) {
          logger.debug(
            { event: "message.skipped", reason: "log_channel" },
            "Message event skipped",
          );
          return { changed: false };
        }
        channelId = channelRecord.id;
        return await withLogContext(
          { channelId: channelRecord.id },
          async () => {
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
              platformMessageId = message.platformMessageId;
              if (
                message.author.isBot ||
                message.author.platformUserId === botId
              ) {
                logger.debug(
                  {
                    event: "message.skipped",
                    reason: "bot_author",
                    platformMessageId: message.platformMessageId,
                  },
                  "Message event skipped",
                );
                return { changed: false };
              }
              if (kind === "CREATE") {
                ({ changed } = await this.messageService.saveMessage(
                  message,
                  null,
                  [],
                  { observedAt },
                ));
                shouldRespond = changed;
              } else {
                ({ changed } = await this.messageService.updateMessage(
                  message,
                  {
                    observed,
                    observedAt,
                  },
                ));
                shouldRespond = observed && changed;
              }
            } else {
              throw new Error(`Unsupported message event: ${kind}`);
            }
            if (shouldRespond) {
              const turnId = session.begin(key, receivedAt);
              logger.debug(
                { event: "conversation.turn.started", turnId },
                "Conversation turn started",
              );
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
            logger.debug(
              {
                event: "message.processed",
                changed,
                deletedCount,
                refreshed: shouldRespond,
                observed,
                reason: shouldRespond
                  ? "response_scheduled"
                  : !changed
                    ? "unchanged"
                    : !observed
                      ? "outside_observation"
                      : "no_response_required",
                durationMs: elapsedMs(startedAt),
              },
              "Message event processed",
            );
            return { changed, deletedCount, refreshed: shouldRespond };
          },
        );
      } catch (error) {
        logger.error(
          {
            event: "message.failed",
            err: error,
            kind,
            channelId,
            platformMessageId,
            durationMs: elapsedMs(startedAt),
          },
          "Message event failed",
        );
        throw error;
      }
    });
  }
}
