import { AppEvents } from "../core/EventBus.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("ChatFlow");

/**
 * Core business logic for generating a response in a conversation.
 * Coordinates Context -> AI generation -> Sender.
 * Side effects that do not control the main response path are emitted as events.
 */
export class ChatFlow {
  /**
   * @param {Object} dependencies
   * @param {import('./context/ChatContextPreparer.js').ChatContextPreparer} dependencies.chatContextPreparer
   * @param {import('../repositories/ChannelRepository.js').ChannelRepository} dependencies.channelRepository
   * @param {import('../ai/ChatGenerator.js').ChatGenerator} dependencies.chatGenerator
   * @param {import('../messages/MessageSender.js').MessageSender} dependencies.messageSender
   * @param {import('./ChatGenerationLifecycle.js').ChatGenerationLifecycle} dependencies.generationLifecycle
   * @param {import('./ChatGenerationFailureHandler.js').ChatGenerationFailureHandler} dependencies.failureHandler
   * @param {import('../core/EventBus.js').EventBus} dependencies.eventBus
   * @param {import('./ChatGenerationAbortRegistry.js').ChatGenerationAbortRegistry} dependencies.generationAbortRegistry
   */
  constructor({
    chatContextPreparer,
    channelRepository,
    chatGenerator,
    messageSender,
    generationLifecycle,
    failureHandler,
    eventBus,
    generationAbortRegistry,
  }) {
    this.chatContextPreparer = chatContextPreparer;
    this.channelRepository = channelRepository;
    this.chatGenerator = chatGenerator;
    this.messageSender = messageSender;
    this.generationLifecycle = generationLifecycle;
    this.failureHandler = failureHandler;
    this.eventBus = eventBus;
    this.generationAbortRegistry = generationAbortRegistry;
  }

  /**
   * Execute the conversation logic.
   * @param {import('../application/contracts.js').ConversationRequest} request
   */
  async execute({ channelPort, internalChannelId, botId, cronMessage = null }) {
    let generation;
    let channelRecord;
    let abortSignal;

    try {
      // 0. Load the latest internal channel state
      const platform = channelPort.platform;
      channelRecord = await this.channelRepository.findById(internalChannelId);
      if (!channelRecord) {
        throw new Error(`Channel ${internalChannelId} no longer exists.`);
      }

      // 1. Start Generation Tracking
      generation =
        await this.generationLifecycle.startChatGeneration(channelRecord);
      abortSignal = this.generationAbortRegistry.register(
        channelRecord.id,
        generation.id,
      );
      await this.eventBus.emitAsync(AppEvents.GenerationStarted, {
        generation,
        channelRecord,
        platform,
        cronMessage,
      });

      // 2. Prepare Context
      const { context, systemInstruction, messageIds, inputMessages } =
        await this.chatContextPreparer.prepare(
          channelRecord.id,
          botId,
          channelRecord,
          cronMessage,
        );

      // 3. Update Generation with input details
      const inputRecorded = await this.generationLifecycle.recordInput(
        generation.id,
        {
          inputMessages,
          messageIds,
        },
      );

      if (inputRecorded === false) {
        logger.info(
          { generationId: generation.id },
          "Generation cancelled before input was recorded",
        );
        await this.eventBus.emitAsync(AppEvents.GenerationCancelled, {
          generation,
          channelRecord,
          platform,
          reason: "cancelled_before_input_record",
        });
        return;
      }

      // 4. Check Cancellation before generating
      const canGenerate = await this.generationLifecycle.canGenerate(
        generation.id,
      );

      if (!canGenerate) {
        logger.info({ generationId: generation.id }, "Generation cancelled");
        await this.eventBus.emitAsync(AppEvents.GenerationCancelled, {
          generation,
          channelRecord,
          platform,
          reason: "status_changed",
        });
        return;
      }

      // 5. Generate and parse the response
      let aiResult;
      try {
        aiResult = await this.chatGenerator.generate(
          context,
          systemInstruction,
          channelPort.platform,
          channelRecord,
          { abortSignal },
        );
      } catch (error) {
        if (!abortSignal.aborted) throw error;

        try {
          await this.generationLifecycle.cancel(generation.id);
        } catch (cancelError) {
          logger.error(
            { err: cancelError, generationId: generation.id },
            "Failed to cancel aborted generation",
          );
        }

        logger.info({ generationId: generation.id }, "Generation aborted");
        await this.eventBus.emitAsync(AppEvents.GenerationCancelled, {
          generation,
          channelRecord,
          platform,
          reason: "aborted_during_generation",
        });
        return;
      }

      if (abortSignal.aborted) {
        try {
          await this.generationLifecycle.cancel(generation.id);
        } catch (cancelError) {
          logger.error(
            { err: cancelError, generationId: generation.id },
            "Failed to cancel aborted generation",
          );
        }

        logger.info({ generationId: generation.id }, "Generation aborted");
        await this.eventBus.emitAsync(AppEvents.GenerationCancelled, {
          generation,
          channelRecord,
          platform,
          reason: "aborted_during_generation",
        });
        return;
      }

      // 6. Save AI response details (including raw API req/res)
      const recorded = await this.generationLifecycle.recordGeneratedOutput(
        generation.id,
        aiResult,
      );
      if (!recorded.shouldProceed) {
        logger.info(
          { generationId: generation.id },
          "Generation cancelled during model execution",
        );
        await this.eventBus.emitAsync(AppEvents.GenerationCancelled, {
          generation,
          channelRecord,
          platform,
          reason: "cancelled_during_generation",
        });
        return;
      }

      // 7. Send each message chunk
      for (const message of aiResult.messages) {
        const sent = await this.messageSender.sendChunk(
          channelPort,
          message,
          generation.id,
        );
        if (!sent) {
          logger.info(
            { generationId: generation.id },
            "Generation cancelled during send",
          );
          await this.eventBus.emitAsync(AppEvents.GenerationCancelled, {
            generation,
            channelRecord,
            platform,
            reason: "send_cancelled",
          });
          return;
        }
      }

      // 8. Mark as COMPLETED after all messages sent
      const completed = await this.generationLifecycle.complete(generation.id);
      if (!completed) {
        logger.info(
          { generationId: generation.id },
          "Generation cancelled before completion",
        );
        await this.eventBus.emitAsync(AppEvents.GenerationCancelled, {
          generation,
          channelRecord,
          platform,
          reason: "cancelled_before_completion",
        });
        return;
      }

      await this.eventBus.emitAsync(AppEvents.GenerationCompleted, {
        generation,
        channelRecord,
        platform,
        aiResult,
      });
    } catch (error) {
      logger.error({ err: error }, "Error processing response");
      await this.failureHandler.handle({
        error,
        generation,
        channelRecord,
        channel: channelPort,
      });
    } finally {
      if (generation && channelRecord) {
        this.generationAbortRegistry.unregister(
          channelRecord.id,
          generation.id,
        );
      }
    }
  }
}
