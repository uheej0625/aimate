import { AppEvents } from "../core/EventBus.js";
import { createLogger } from "../core/logger.js";

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

  async execute({
    channelPort,
    internalChannelId,
    botId,
    cronMessage = null,
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
    let sentAt;
    let settled = false;
    const payload = () => ({
      generation,
      channelRecord,
      platform: channelPort.platform,
    });
    const cancel = async (reason) => {
      if (generation) await this.generationLifecycle.cancel(generation.id);
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
      if (!started) return;
      await this.eventBus.emitAsync(AppEvents.GenerationStarted, {
        ...payload(),
        cronMessage,
      });

      const prepared = await run(async () => {
        if (!isCurrent()) return null;
        const input = await this.chatContextPreparer.prepare(
          internalChannelId,
          botId,
          channelRecord,
          cronMessage,
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
      const aiResult = await this.chatGenerator.generate(
        prepared.context,
        prepared.systemInstruction,
        channelPort.platform,
        channelRecord,
        { abortSignal },
      );
      if (!isCurrent()) return await cancel("aborted_during_generation");
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

      for (const message of aiResult.messages) {
        if (
          !isCurrent() ||
          !(await this.messageSender.sendChunk(
            channelPort,
            message,
            generation.id,
            delivery,
          ))
        ) {
          return await cancel("send_cancelled");
        }
      }
      if (!sentAt)
        throw new Error(
          "The generated response contained no deliverable messages.",
        );
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
    } catch (error) {
      if (generation && !isCurrent()) {
        await cancel("aborted_during_generation");
      } else {
        logger.error({ err: error }, "Error processing response");
        await this.failureHandler.handle({
          error,
          generation,
          channelRecord,
          channel: channelPort,
          delivery: { run, isCurrent },
        });
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
