import { AppEvents, EventBus } from "../core/EventBus.js";
import { createLogger } from "../core/logger.js";
import { ChatGenerationFailureHandler } from "./ChatGenerationFailureHandler.js";
import { ChatGenerationLifecycle } from "./ChatGenerationLifecycle.js";

const logger = createLogger("ChatFlow");

/**
 * Core business logic for generating a response in a conversation.
 * Coordinates Context -> AI generation -> Sender.
 * Side effects that do not control the main response path are emitted as events.
 */
export class ChatFlow {
  /**
   * @param {import('../repositories/GenerationRepository.js').GenerationRepository} generationRepository
   * @param {import('../repositories/ChannelRepository.js').ChannelRepository} channelRepository
   * @param {import('../repositories/MessageRepository.js').MessageRepository} messageRepository
   * @param {import('./context/ChatContextPreparer.js').ChatContextPreparer} chatContextPreparer
   * @param {import('../ai/ChatGenerator.js').ChatGenerator} chatGenerator
   * @param {import('../messages/MessageSender.js').MessageSender} messageSender
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {Object} [options]
   * @param {import('../core/EventBus.js').EventBus} [options.eventBus]
   * @param {import('./ChatGenerationLifecycle.js').ChatGenerationLifecycle} [options.generationLifecycle]
   * @param {import('./ChatGenerationFailureHandler.js').ChatGenerationFailureHandler} [options.failureHandler]
   */
  constructor(
    generationRepository,
    channelRepository,
    messageRepository,
    chatContextPreparer,
    chatGenerator,
    messageSender,
    configManager,
    { eventBus, generationLifecycle, failureHandler } = {},
  ) {
    this.chatContextPreparer = chatContextPreparer;
    this.chatGenerator = chatGenerator;
    this.messageSender = messageSender;
    this.eventBus = eventBus ?? new EventBus();
    this.generationLifecycle =
      generationLifecycle ??
      new ChatGenerationLifecycle(
        generationRepository,
        channelRepository,
        messageRepository,
        configManager,
      );
    this.failureHandler =
      failureHandler ??
      new ChatGenerationFailureHandler(
        this.generationLifecycle,
        this.messageSender,
        this.eventBus,
      );
  }

  /**
   * Execute the conversation logic.
   * @param {Object} channel - The platform-specific channel object (e.g., Discord TextBasedChannel)
   * @param {string} botId
   * @param {string} [cronMessage] - Cron job에서 전달되는 시스템 메시지 (선택)
   */
  async execute(channel, botId, cronMessage = null) {
    let generation;
    let channelRecord;

    try {
      // 0. Get or create internal channel
      const platform = channel.platform;
      channelRecord =
        await this.generationLifecycle.findOrCreateChannel(channel);

      // 1. Start Generation Tracking
      generation =
        await this.generationLifecycle.startChatGeneration(channelRecord);
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
      await this.generationLifecycle.recordInput(generation.id, {
        inputMessages,
        messageIds,
      });

      // 4. Check Cancellation before generating
      const result = await this.generationLifecycle.markReadyToGenerate(
        generation.id,
      );

      if (!result.shouldProceed) {
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
      const aiResult = await this.chatGenerator.generate(
        context,
        systemInstruction,
        channel.platform,
        channelRecord,
      );

      // 6. Save AI response details (including raw API req/res)
      await this.generationLifecycle.recordOutput(generation.id, aiResult);

      // 7. Send each message chunk
      for (const message of aiResult.messages) {
        const sent = await this.messageSender.sendChunk(
          channel,
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
      await this.generationLifecycle.complete(generation.id);

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
        channel,
      });
    }
  }
}
