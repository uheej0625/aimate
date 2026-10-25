import { AppEvents } from "../core/EventBus.js";
import { createLogger, elapsedMs, withLogContext } from "../core/logger.js";

const logger = createLogger("ChatFlow");

/** Coordinates one owned turn. Slow generation and delivery never hold the queue. */
export class ChatFlow {
  constructor({
    chatContextPreparer,
    channelRepository,
    chatGenerator,
    messageSender,
    generationLifecycle,
    failureHandler,
    eventBus,
    generationAbortRegistry,
    conversationSession,
  }) {
    Object.assign(this, {
      chatContextPreparer,
      channelRepository,
      chatGenerator,
      messageSender,
      generationLifecycle,
      failureHandler,
      eventBus,
      generationAbortRegistry,
      conversationSession,
    });
  }

  execute(request) {
    return withLogContext(
      {
        platform: request.channelPort.platform,
        platformChannelId: request.channelPort.platformChannelId,
        channelId: request.internalChannelId,
        generationType: "CHAT",
        rerollGenerationId: request.rerollGenerationId ?? undefined,
      },
      () => this.executeTurn(request),
    );
  }

  async executeTurn({
    channelPort,
    internalChannelId,
    botId,
    turnId = null,
    rerollGenerationId = null,
  }) {
    const session = this.conversationSession;
    const key = session.key(channelPort);
    const run = (operation) => session.run(key, operation);
    const isCurrent = () =>
      session.isCurrent(key, turnId) && !abortSignal?.aborted;
    let generation;
    let channelRecord;
    let abortSignal;
    let deliveredAt;
    let sentAt = null;
    let settled = false;
    const startedAt = performance.now();
    let stage = "start";
    let stageStartedAt = startedAt;
    const fields = () => ({ turnId, generationId: generation?.id });
    logger.debug(
      { ...fields(), event: "generation.requested" },
      "Chat generation requested",
    );
    const nextStage = (next) => {
      logger.debug(
        {
          ...fields(),
          event: "generation.stage.completed",
          stage,
          durationMs: elapsedMs(stageStartedAt),
        },
        "Generation stage completed",
      );
      stage = next;
      stageStartedAt = performance.now();
      logger.debug(
        { ...fields(), event: "generation.stage.started", stage },
        "Generation stage started",
      );
    };
    const payload = () => ({
      generation,
      channelRecord,
      platform: channelPort.platform,
    });
    const cancel = async (reason) => {
      if (generation) await this.generationLifecycle.cancel(generation.id);
      logger.info(
        {
          ...fields(),
          event: "generation.cancelled",
          reason,
          stage,
          delivered: !!sentAt,
          durationMs: elapsedMs(startedAt),
        },
        "Chat generation cancelled",
      );
      await this.eventBus.emitAsync(AppEvents.GenerationCancelled, {
        ...payload(),
        reason,
      });
    };
    const delivery = {
      run,
      isCurrent,
      onDelivered: () => {
        deliveredAt = session.now();
        sentAt = new Date();
      },
    };

    try {
      const started = await run(async () => {
        if (turnId && !isCurrent()) return false;
        turnId ??= session.begin(key);
        channelRecord =
          await this.channelRepository.findById(internalChannelId);
        if (!channelRecord)
          throw new Error(`Channel ${internalChannelId} no longer exists.`);
        this.generationAbortRegistry.abortChannel(internalChannelId);
        await this.generationLifecycle.cancelActiveForChannel(
          internalChannelId,
        );
        generation =
          await this.generationLifecycle.startChatGeneration(channelRecord);
        abortSignal = this.generationAbortRegistry.register(
          internalChannelId,
          generation.id,
        );
        return true;
      });
      if (!started) {
        logger.debug(
          { ...fields(), event: "generation.skipped", reason: "stale_turn" },
          "Stale turn skipped",
        );
        return;
      }
      await withLogContext(fields(), async () => {
        logger.info({ event: "generation.started" }, "Chat generation started");
        await this.eventBus.emitAsync(AppEvents.GenerationStarted, {
          ...payload(),
        });

        nextStage("prepare_input");
        const prepared = await run(async () => {
          if (!isCurrent()) return null;
          const input = await this.chatContextPreparer.prepare(
            internalChannelId,
            botId,
            channelRecord,
            rerollGenerationId,
          );
          const recorded = await this.generationLifecycle.recordInput(
            generation.id,
            input,
          );
          return recorded === false ? null : input;
        });
        if (!prepared) return await cancel("cancelled_before_input_record");
        if (
          !isCurrent() ||
          !(await this.generationLifecycle.canGenerate(generation.id))
        ) {
          return await cancel("status_changed");
        }
        logger.debug(
          {
            event: "generation.input.prepared",
            contextMessageCount: prepared.context.length,
            inputMessageCount: prepared.messageIds.length,
            eventCount: prepared.eventSnapshot?.events?.length ?? 0,
          },
          "Generation input prepared",
        );
        nextStage("model");
        const aiResult = await this.chatGenerator.generate(
          prepared.context,
          prepared.systemInstruction,
          channelPort.platform,
          channelRecord,
          { abortSignal, channelPort, generationId: generation.id, delivery },
        );
        if (!isCurrent()) return await cancel("aborted_during_generation");
        nextStage("record_output");
        const accepted = await run(async () => {
          if (!isCurrent()) return false;
          return (
            await this.generationLifecycle.recordGeneratedOutput(
              generation.id,
              aiResult,
            )
          ).shouldProceed;
        });
        if (!accepted) return await cancel("cancelled_during_generation");

        nextStage("delivery");
        for (const message of aiResult.messages) {
          if (
            !isCurrent() ||
            !(await this.messageSender.send(
              channelPort,
              message,
              generation.id,
              delivery,
            ))
          ) {
            return await cancel("send_cancelled");
          }
        }
        if (!sentAt && aiResult.messages.length > 0)
          throw new Error(
            "The generated response contained no deliverable messages or successful message actions.",
          );
        nextStage("complete");
        const completed = await run(async () => {
          if (!isCurrent()) return false;
          const result = await this.generationLifecycle.complete(
            generation.id,
            sentAt,
          );
          if (result) {
            session.settle(key, turnId, deliveredAt);
            settled = true;
          }
          return result;
        });
        if (!completed) return await cancel("cancelled_before_completion");
        logger.debug(
          {
            event: "generation.stage.completed",
            stage,
            durationMs: elapsedMs(stageStartedAt),
          },
          "Generation stage completed",
        );
        logger.info(
          {
            event: "generation.completed",
            messageCount: aiResult.messages.length,
            delivered: !!sentAt,
            durationMs: elapsedMs(startedAt),
          },
          "Chat generation completed",
        );
        // Consumers receive the same fixed input that was used by this generation.
        generation.input = JSON.stringify({
          messages: prepared.inputMessages.map((content, index) => ({
            id: prepared.messageIds[index],
            content,
          })),
          eventSnapshot: prepared.eventSnapshot,
        });
        await this.eventBus.emitAsync(AppEvents.GenerationCompleted, {
          ...payload(),
          aiResult,
        });
      });
    } catch (error) {
      if (generation && !isCurrent()) {
        await cancel("aborted_during_generation");
      } else {
        logger.error(
          {
            ...fields(),
            event: "generation.failed",
            err: error,
            stage,
            stageDurationMs: elapsedMs(stageStartedAt),
            durationMs: elapsedMs(startedAt),
          },
          "Chat generation failed",
        );
        await withLogContext(fields(), () =>
          this.failureHandler.handle({
            error,
            generation,
            channelRecord,
            channel: channelPort,
            delivery: { run, isCurrent },
          }),
        );
      }
    } finally {
      if (generation)
        this.generationAbortRegistry.unregister(
          internalChannelId,
          generation.id,
        );
      if (!settled && turnId) await run(() => session.settle(key, turnId));
    }
  }
}
