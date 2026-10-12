import { createLogger } from "../core/logger.js";
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
    for (const chunk of this.messageSplitter.split(text, maxLength)) {
      if (!(await this._sendChunk(channel, chunk, generationId, delivery))) {
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
      allowFailure = false,
    } = {},
  ) {
    if (!isCurrent()) return false;
    if (!text) return true;

    const { cleanText, files, generatedImageAttachments } =
      await this.generatedImageAttachmentResolver.resolve(text);

    // 텍스트도 없고 파일도 없으면 스킵
    if (!cleanText && files.length === 0) return true;

    if (this.configManager.get("humanize.enabled") !== false) {
      await channel.sendTyping();
      const delay = this.typingPacer.calculate(cleanText, {
        min: this.configManager.get("humanize.typingDelayMin"),
        max: this.configManager.get("humanize.typingDelayMax"),
        perChar: this.configManager.get("humanize.typingDelayPerChar"),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const started = await run(async () => {
      if (!isCurrent()) return null;
      if (generationId) {
        const generation =
          await this.generationRepository.findById(generationId);
        const allowed = allowFailure ? ["FAILED"] : ["GENERATED"];
        if (!generation || !allowed.includes(generation.status)) {
          logger.debug(
            { generationId },
            "Generation cancelled, stopping message send",
          );
          return null;
        }
      }

      // 전송 옵션 구성
      const sendOptions = {};
      if (cleanText) sendOptions.content = cleanText;
      if (files.length > 0) sendOptions.files = files;

      // Release the queue once delivery has started; its network round trip is slow.
      return { delivery: channel.send(sendOptions) };
    });
    if (!started) return false;
    const message = await started.delivery;
    const observedAt = new Date();
    onDelivered();

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
        { err: error, platformMessageId: message.platformMessageId },
        "Retrying storage of confirmed delivery",
      );
      await save();
    }

    return true;
  }
}
