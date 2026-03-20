import { createLogger } from "./logger.js";

const logger = createLogger("MessageSender");

/**
 * Handles sending messages to Discord.
 * Responsible for splitting long messages and managing typing indicators.
 */
export class MessageSender {
  /**
   * @param {import('../services/MessageService.js').MessageService} messageService
   * @param {import('../repositories/GenerationRepository.js').GenerationRepository} generationRepository
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(messageService, generationRepository, configManager) {
    this.messageService = messageService;
    this.generationRepository = generationRepository;
    this.configManager = configManager;
  }

  /**
   * Send a single text chunk to Discord with typing indicator and delay.
   * Returns true if sent successfully, false if the generation was cancelled.
   * @param {import('discord.js').TextBasedChannel} channel
   * @param {string} text
   * @param {string} generationId - Generation ID to check for cancellation
   * @returns {Promise<boolean>}
   */
  async sendChunk(channel, text, generationId) {
    if (!text) return true;

    await channel.sendTyping();

    const delay = this._calculateDelay(text);
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (generationId) {
      const generation = await this.generationRepository.findById(generationId);
      if (!generation || generation.status === "CANCELLED") {
        logger.debug(
          { generationId },
          "Generation cancelled, stopping message send",
        );
        return false;
      }
    }

    const message = await channel.send(text);

    // Save message with all related entities
    await this.messageService.saveMessage(message, generationId);

    return true;
  }

  /**
   * Send a full response, splitting by the configured break tag.
   * Convenience wrapper that delegates each chunk to sendChunk.
   * @param {import('discord.js').TextBasedChannel} channel
   * @param {string} responseText
   * @param {string} generationId - Generation ID to check for cancellation
   */
  async send(channel, responseText, generationId) {
    if (!responseText) return;

    const chunks = responseText
      .split(this.configManager.get("conversation.messageBreakTag"))
      .map((c) => c.trim())
      .filter((c) => c);

    for (const chunk of chunks) {
      const sent = await this.sendChunk(channel, chunk, generationId);
      if (!sent) return;
    }
  }

  /**
   * Calculate typing delay based on text length.
   * @param {string} text
   * @returns {number} Delay in milliseconds
   */
  _calculateDelay(text) {
    return Math.min(
      this.configManager.get("conversation.typingDelayMax"),
      Math.max(
        this.configManager.get("conversation.typingDelayMin"),
        text.length * this.configManager.get("conversation.typingDelayPerChar"),
      ),
    );
  }
}
