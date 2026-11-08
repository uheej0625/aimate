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
    conversationPolicy = null,
  ) {
    Object.assign(this, {
      messageService,
      generationLifecycle,
      conversationBuffer,
      channelRepository,
      generationAbortRegistry,
      conversationSession,
      conversationPolicy,
    });
  }

  async stopDisabledConversations() {
    const session = this.conversationSession;
    for (const key of [...session.states.keys()]) {
      if (!session.isWatching(key)) continue;
      const [platform, platformChannelId] = JSON.parse(key);
      const channel = { platform, platformChannelId };
      await session.run(key, async () => {
        if (await this.conversationPolicy.isEnabled(channel)) return;
        this.conversationBuffer.clear(channel);
        session.stop(key);
        const record = await this.channelRepository.findByPlatformId(
          platform,
          platformChannelId,
        );
        if (record) {
          this.generationAbortRegistry.abortChannel(record.id);
          await this.generationLifecycle.cancelActiveForChannel(record.id);
        }
      });
    }
  }

  handle(event) {
    if (this.closed) return Promise.resolve({ changed: false });
    return withLogContext(
      {
        platform: event.channel.platform,
        characterId: this.messageService.characterId,
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
    let platformMessageId =
      event.message?.platformMessageId ?? event.platformMessageId;
    logger.debug(
      {
        event: "message.received",
        messageCount: event.platformMessageIds?.length ?? 1,
      },
      "Message event received",
    );
    return await session.run(key, async () => {
      if (this.closed) return { changed: false };
      logger.debug(
        { event: "message.processing", queueWaitMs: elapsedMs(startedAt) },
        "Message event dequeued",
      );
      try {
        let channelRecord = await this.channelRepository.findByPlatformId(
          channel.platform,
          channel.platformChannelId,
        );
        if (!channelRecord && !this.conversationPolicy) {
          logger.debug(
            { event: "message.skipped", reason: "unregistered_channel" },
            "Message event skipped",
          );
          return { changed: false };
        }
        if (channelRecord?.logEnabled) {
          logger.debug(
            { event: "message.skipped", reason: "log_channel" },
            "Message event skipped",
          );
          return { changed: false };
        }
        const enabled = this.conversationPolicy
          ? await this.conversationPolicy.isEnabled(channel)
          : true;
        if (!enabled && kind === "CREATE") return { changed: false };
        if (!channelRecord && kind !== "CREATE") return { changed: false };
        if (
          !enabled &&
          kind === "UPDATE" &&
          !(await this.messageService.hasStoredMessage(
            channel.platform,
            platformMessageId,
          ))
        ) {
          return { changed: false };
        }
        const observed = enabled && session.isWatching(key, receivedAt);
        channelId = channelRecord?.id;
        return await withLogContext({ channelId }, async () => {
          let changed = false;
          let observedChanged = false;
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
            observedChanged = result.observedMessages.length > 0;
            shouldRespond =
              observed &&
              result.observedMessages.some(
                (message) =>
                  message.authorId &&
                  (!message.isBot || message.author?.user?.characterId) &&
                  message.author?.platformId !== botId,
              );
          } else if (kind === "CREATE" || kind === "UPDATE") {
            // Lazy platform hydration stays inside the receive-order queue.
            const message = event.message ?? (await event.loadMessage());
            platformMessageId = message.platformMessageId;
            if (message.author.platformUserId === botId) {
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
              const result = await this.messageService.saveMessage(
                message,
                null,
                undefined,
                { observedAt },
              );
              changed = result.changed;
              observedChanged = result.observedChanged;
              channelRecord ??= result.channel;
              shouldRespond =
                observedChanged &&
                (!message.author.isBot || result.authorCharacterId);
            } else {
              const result = await this.messageService.updateMessage(message, {
                observed,
                observedAt,
                storedOnly: !enabled,
              });
              ({ changed, observedChanged } = result);
              shouldRespond =
                observed &&
                observedChanged &&
                (!message.author.isBot || result.authorCharacterId);
            }
          } else {
            throw new Error(`Unsupported message event: ${kind}`);
          }
          if (shouldRespond && !observed && channel.readHistory) {
            await this.messageService.readRecentHistory(channel, {
              before: platformMessageId,
              canRead: async () =>
                !this.conversationPolicy ||
                (await this.conversationPolicy.isEnabled(channel)),
            });
          }
          if (
            shouldRespond &&
            this.conversationPolicy &&
            !(await this.conversationPolicy.isEnabled(channel))
          ) {
            shouldRespond = false;
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
              observedChanged,
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
          return {
            changed,
            observedChanged,
            deletedCount,
            refreshed: shouldRespond,
          };
        });
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
