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
    conversationPolicy = null,
  }) {
    this.tasks = new Map();
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
      conversationPolicy,
    });
  }

  execute(request) {
    if (this.closed) return Promise.resolve();
    const task = withLogContext(
      {
        platform: request.channelPort.platform,
        characterId: this.generationLifecycle.generationRepository?.characterId,
        platformChannelId: request.channelPort.platformChannelId,
        channelId: request.internalChannelId,
        generationType: "CHAT",
        rerollGenerationId: request.rerollGenerationId ?? undefined,
      },
      () => this.executeTurn(request),
    );
    this.tasks.set(task, request.channelPort.platform);
    task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task),
    );
    return task;
  }

  async executeTurn(request) {
    const turn = this.#createTurn(request);
    logger.debug(
      { ...turn.fields(), event: "generation.requested" },
      "Chat generation requested",
    );

    try {
      if (!(await this.#startTurn(turn))) return;
      await withLogContext(turn.fields(), async () => {
        logger.info({ event: "generation.started" }, "Chat generation started");
        await this.eventBus.emitAsync(
          AppEvents.GenerationStarted,
          turn.payload(),
        );

        const prepared = await this.#prepareInput(turn);
        if (!prepared)
          return await this.#cancel(turn, "cancelled_before_input_record");
        if (
          !(await turn.delivery.canDeliver()) ||
          !(await this.generationLifecycle.canGenerate(turn.generation.id))
        ) {
          return await this.#cancel(turn, "status_changed");
        }

        const aiResult = await this.#runModel(turn, prepared);
        if (!turn.isCurrent())
          return await this.#cancel(turn, "aborted_during_generation");
        if (!(await this.#recordOutput(turn, aiResult)))
          return await this.#cancel(turn, "cancelled_during_generation");
        if (!(await this.#deliverMessages(turn, aiResult.messages)))
          return await this.#cancel(turn, "send_cancelled");
        if (!(await this.#complete(turn, prepared, aiResult)))
          return await this.#cancel(turn, "cancelled_before_completion");
      });
    } catch (error) {
      if (turn.generation && !turn.isCurrent()) {
        await this.#cancel(turn, "aborted_during_generation");
      } else {
        logger.error(
          {
            ...turn.fields(),
            event: "generation.failed",
            err: error,
            stage: turn.stage,
            stageDurationMs: elapsedMs(turn.stageStartedAt),
            durationMs: elapsedMs(turn.startedAt),
          },
          "Chat generation failed",
        );
        await withLogContext(turn.fields(), () =>
          this.failureHandler.handle({
            error,
            generation: turn.generation,
            channelRecord: turn.channelRecord,
            channel: turn.channelPort,
            delivery: turn.delivery,
          }),
        );
      }
    } finally {
      if (turn.generation)
        this.generationAbortRegistry.unregister(
          turn.internalChannelId,
          turn.generation.id,
        );
      if (!turn.settled && turn.turnId)
        await turn.run(() =>
          this.conversationSession.settle(turn.key, turn.turnId),
        );
    }
  }

  #createTurn(request) {
    const session = this.conversationSession;
    const startedAt = performance.now();
    const turn = {
      ...request,
      turnId: request.turnId ?? null,
      rerollGenerationId: request.rerollGenerationId ?? null,
      key: session.key(request.channelPort),
      sentAt: null,
      settled: false,
      startedAt,
      stage: "start",
      stageStartedAt: startedAt,
    };
    turn.run = (operation) => session.run(turn.key, operation);
    turn.isCurrent = () =>
      !this.closed &&
      session.isCurrent(turn.key, turn.turnId) &&
      !turn.abortSignal?.aborted;
    turn.fields = () => ({
      turnId: turn.turnId,
      generationId: turn.generation?.id,
    });
    turn.payload = () => ({
      generation: turn.generation,
      channelRecord: turn.channelRecord,
      platform: turn.channelPort.platform,
    });
    turn.delivery = {
      run: turn.run,
      isCurrent: turn.isCurrent,
      canDeliver: async () =>
        turn.isCurrent() &&
        (!this.conversationPolicy ||
          (await this.conversationPolicy.isEnabled(turn.channelPort))) &&
        turn.isCurrent(),
      onDelivered: () => {
        turn.deliveredAt = session.now();
        turn.sentAt = new Date();
      },
    };
    return turn;
  }

  async #startTurn(turn) {
    const started = await turn.run(async () => {
      if (this.closed || (turn.turnId && !turn.isCurrent())) return false;
      if (
        this.conversationPolicy &&
        !(await this.conversationPolicy.isEnabled(turn.channelPort))
      ) {
        this.conversationSession.stop(turn.key);
        return false;
      }
      turn.turnId ??= this.conversationSession.begin(turn.key);
      turn.channelRecord = await this.channelRepository.findById(
        turn.internalChannelId,
      );
      if (!turn.channelRecord)
        throw new Error(`Channel ${turn.internalChannelId} no longer exists.`);
      this.generationAbortRegistry.abortChannel(turn.internalChannelId);
      await this.generationLifecycle.cancelActiveForChannel(
        turn.internalChannelId,
      );
      turn.generation = await this.generationLifecycle.startChatGeneration(
        turn.channelRecord,
      );
      turn.abortSignal = this.generationAbortRegistry.register(
        turn.internalChannelId,
        turn.generation.id,
      );
      return true;
    });
    if (!started)
      logger.debug(
        { ...turn.fields(), event: "generation.skipped", reason: "stale_turn" },
        "Stale turn skipped",
      );
    return started;
  }

  async #prepareInput(turn) {
    this.#nextStage(turn, "prepare_input");
    const prepared = await turn.run(async () => {
      if (!turn.isCurrent()) return null;
      const input = await this.chatContextPreparer.prepare(
        turn.internalChannelId,
        turn.botId,
        turn.channelRecord,
        turn.rerollGenerationId,
      );
      const recorded = await this.generationLifecycle.recordInput(
        turn.generation.id,
        input,
      );
      return recorded === false ? null : input;
    });
    if (prepared)
      logger.debug(
        {
          event: "generation.input.prepared",
          contextMessageCount: prepared.context.length,
          inputMessageCount: prepared.messageIds.length,
          eventCount: prepared.eventSnapshot?.events?.length ?? 0,
        },
        "Generation input prepared",
      );
    return prepared;
  }

  #runModel(turn, prepared) {
    this.#nextStage(turn, "model");
    return this.chatGenerator.generate(
      prepared.context,
      prepared.systemInstruction,
      turn.channelPort.platform,
      turn.channelRecord,
      {
        abortSignal: turn.abortSignal,
        channelPort: turn.channelPort,
        generationId: turn.generation.id,
        delivery: turn.delivery,
        participantResolver: prepared.participantResolver,
      },
    );
  }

  #recordOutput(turn, aiResult) {
    this.#nextStage(turn, "record_output");
    return turn.run(async () => {
      if (!(await turn.delivery.canDeliver())) return false;
      return (
        await this.generationLifecycle.recordGeneratedOutput(
          turn.generation.id,
          aiResult,
        )
      ).shouldProceed;
    });
  }

  async #deliverMessages(turn, messages) {
    this.#nextStage(turn, "delivery");
    for (const message of messages) {
      if (
        !turn.isCurrent() ||
        !(await this.messageSender.send(
          turn.channelPort,
          message,
          turn.generation.id,
          turn.delivery,
        ))
      ) {
        return false;
      }
    }
    if (!turn.sentAt && messages.length > 0)
      throw new Error(
        "The generated response contained no deliverable messages or successful message actions.",
      );
    return true;
  }

  async #complete(turn, prepared, aiResult) {
    this.#nextStage(turn, "complete");
    const completed = await turn.run(async () => {
      if (!(await turn.delivery.canDeliver())) return false;
      const result = await this.generationLifecycle.complete(
        turn.generation.id,
        turn.sentAt,
      );
      if (result) {
        this.conversationSession.settle(
          turn.key,
          turn.turnId,
          turn.deliveredAt,
        );
        turn.settled = true;
      }
      return result;
    });
    if (!completed) return false;

    this.#logStageCompleted(turn);
    logger.info(
      {
        event: "generation.completed",
        messageCount: aiResult.messages.length,
        delivered: !!turn.sentAt,
        durationMs: elapsedMs(turn.startedAt),
      },
      "Chat generation completed",
    );
    // Consumers receive the same fixed input that was used by this generation.
    turn.generation.input = JSON.stringify({
      messages: prepared.inputMessages.map((content, index) => ({
        id: prepared.messageIds[index],
        content,
      })),
      eventSnapshot: prepared.eventSnapshot,
    });
    await this.eventBus.emitAsync(AppEvents.GenerationCompleted, {
      ...turn.payload(),
      aiResult,
    });
    return true;
  }

  async #cancel(turn, reason) {
    if (turn.generation)
      await this.generationLifecycle.cancel(turn.generation.id);
    logger.info(
      {
        ...turn.fields(),
        event: "generation.cancelled",
        reason,
        stage: turn.stage,
        delivered: !!turn.sentAt,
        durationMs: elapsedMs(turn.startedAt),
      },
      "Chat generation cancelled",
    );
    await this.eventBus.emitAsync(AppEvents.GenerationCancelled, {
      ...turn.payload(),
      reason,
    });
  }

  #nextStage(turn, stage) {
    this.#logStageCompleted(turn);
    turn.stage = stage;
    turn.stageStartedAt = performance.now();
    logger.debug(
      { ...turn.fields(), event: "generation.stage.started", stage },
      "Generation stage started",
    );
  }

  #logStageCompleted(turn) {
    logger.debug(
      {
        ...turn.fields(),
        event: "generation.stage.completed",
        stage: turn.stage,
        durationMs: elapsedMs(turn.stageStartedAt),
      },
      "Generation stage completed",
    );
  }
}
