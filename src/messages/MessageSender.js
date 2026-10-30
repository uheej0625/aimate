import { createLogger, elapsedMs, withLogContext } from "../core/logger.js";
import { GeneratedImageAttachmentResolver } from "./GeneratedImageAttachmentResolver.js";
import { MessageSplitter } from "./MessageSplitter.js";
import { TypingPacer } from "../humanize/TypingPacer.js";

const logger = createLogger("MessageSender");

/**
 * Handles sending messages through a platform channel.
 * Splits messages and manages attachments, pacing, cancellation and delivery storage.
 */
export class MessageSender {
  /**
   * @param {import('../messages/MessageService.js').MessageService} messageService
   * @param {import('../repositories/GenerationRepository.js').GenerationRepository} generationRepository
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {Object} [options]
   * @param {GeneratedImageAttachmentResolver} [options.generatedImageAttachmentResolver]
   * @param {MessageSplitter} [options.messageSplitter]
   * @param {TypingPacer} [options.typingPacer]
   */
  constructor(
    messageService,
    generationRepository,
    configManager,
    {
      generatedImageAttachmentResolver = null,
      messageSplitter = new MessageSplitter(),
      typingPacer = new TypingPacer(),
    } = {},
  ) {
    this.messageService = messageService;
    this.generationRepository = generationRepository;
    this.configManager = configManager;
    this.messageSplitter = messageSplitter;
    this.typingPacer = typingPacer;
    this.generatedImageAttachmentResolver =
      generatedImageAttachmentResolver ??
      new GeneratedImageAttachmentResolver(generationRepository);
  }

  /**
   * Send one logical message in transport-sized chunks, preserving their order.
   * Returns true if sent successfully, false if the generation was cancelled.
   * @param {import('../application/contracts.js').ChannelPort} channel
   * @param {string} text
   * @param {string} generationId - Generation ID to check for cancellation
   * @returns {Promise<boolean>}
   */
  async send(channel, text, generationId, delivery = {}) {
    if (delivery.isCurrent && !delivery.isCurrent()) return false;
    if (!text) return true;

    const maxLength = this.configManager.get("messages.maxLength") ?? 1900;
    const chunks = this.messageSplitter.split(text, maxLength);
    for (const [chunkIndex, chunk] of chunks.entries()) {
      if (
        !(await withLogContext(
          {
            platform: channel.platform,
            platformChannelId: channel.platformChannelId,
            generationId,
            chunkIndex,
            chunkCount: chunks.length,
          },
          () => this._sendChunk(channel, chunk, generationId, delivery),
        ))
      ) {
        return false;
      }
    }
    return true;
  }

  async _sendChunk(
    channel,
    text,
    generationId,
    {
      run = (operation) => operation(),
      isCurrent = () => true,
      onDelivered = () => {},
    } = {},
  ) {
    if (!isCurrent()) {
      logger.debug(
        { event: "message.send.skipped", reason: "stale_turn" },
        "Message delivery skipped",
      );
      return false;
    }
    if (!text) return true;

    const { cleanText, files, generatedImageAttachments } =
      await this.generatedImageAttachmentResolver.resolve(text);

    // 텍스트도 없고 파일도 없으면 스킵
    if (!cleanText && files.length === 0) {
      logger.debug(
        {
          event: "message.send.skipped",
          reason: "empty_after_attachment_resolution",
        },
        "Message delivery skipped",
      );
      return true;
    }

    if (this.configManager.get("humanize.enabled") !== false) {
      await channel.sendTyping();
      const delay = this.typingPacer.calculate(cleanText, {
        min: this.configManager.get("humanize.typingDelayMin"),
        max: this.configManager.get("humanize.typingDelayMax"),
        perChar: this.configManager.get("humanize.typingDelayPerChar"),
      });
      logger.debug(
        { event: "message.send.pacing", delayMs: delay },
        "Message typing delay",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const started = await run(async () => {
      if (!isCurrent()) return null;
      if (generationId) {
        const generation =
          await this.generationRepository.findById(generationId);
        if (!generation || generation.status !== "GENERATED") {
          logger.debug(
            {
              event: "message.send.skipped",
              generationId,
              status: generation?.status,
              reason: "generation_status",
            },
            "Generation cancelled, stopping message send",
          );
          return null;
        }
      }

      // 전송 옵션 구성
      const sendOptions = {};
      if (cleanText) sendOptions.content = cleanText;
      if (files.length > 0) sendOptions.files = files;
      logger.debug(
        {
          event: "message.send.started",
          textLength: cleanText.length,
          attachmentCount: files.length,
        },
        "Message delivery started",
      );

      // Release the queue once delivery has started; its network round trip is slow.
      const startedAt = performance.now();
      return { delivery: channel.send(sendOptions), startedAt };
    });
    if (!started) return false;
    let message;
    try {
      message = await started.delivery;
    } catch (error) {
      logger.error(
        {
          event: "message.send.failed",
          err: error,
          durationMs: elapsedMs(started.startedAt),
        },
        "Message delivery failed",
      );
      throw error;
    }
    const observedAt = new Date();
    onDelivered();
    logger.debug(
      {
        event: "message.send.completed",
        platformMessageId: message.platformMessageId,
        durationMs: elapsedMs(started.startedAt),
      },
      "Message delivery confirmed",
    );

    // Save message with all related entities
    const save = () =>
      run(() =>
        this.messageService.saveMessage(
          message,
          generationId,
          generatedImageAttachments,
          { observedAt },
        ),
      );
    try {
      await save();
    } catch (error) {
      logger.warn(
        {
          event: "message.storage.retry",
          err: error,
          platformMessageId: message.platformMessageId,
        },
        "Retrying storage of confirmed delivery",
      );
      try {
        await save();
      } catch (retryError) {
        logger.error(
          {
            event: "message.storage.failed",
            err: retryError,
            platformMessageId: message.platformMessageId,
          },
          "Confirmed delivery could not be stored",
        );
        throw retryError;
      }
    }
    logger.debug(
      {
        event: "message.storage.completed",
        platformMessageId: message.platformMessageId,
      },
      "Delivered message stored",
    );

    return true;
  }
}
