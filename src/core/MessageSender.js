import fs from "fs";
import path from "path";
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

    // --- 멀티모달 이미지 태그 파싱 ---
    const imageRegex = /\[IMAGE:(.*?)\]/g;
    const files = [];
    let match;
    while ((match = imageRegex.exec(text)) !== null) {
      const parsedValue = match[1].trim();
      let attachmentPath = parsedValue;

      // 만약 경로를 뜻하는 slash가 없다면 (imageId 등으로 추론)
      if (!parsedValue.includes("/") && !parsedValue.includes("\\\\")) {
        const filename = parsedValue.endsWith(".png")
          ? parsedValue
          : `${parsedValue}.png`;
        const localPath = path.join(
          process.cwd(),
          "content",
          "image",
          filename,
        );
        if (fs.existsSync(localPath)) {
          attachmentPath = localPath;
        }
      }

      files.push({ attachment: attachmentPath });
    }

    // 파일 경로 태그를 텍스트에서 제거 후 앞뒤 공백 정리
    const cleanText = text.replace(imageRegex, "").trim();

    // 텍스트도 없고 파일도 없으면 스킵
    if (!cleanText && files.length === 0) return true;

    // Discord.js 채널이 아닐 경우(cli 등)를 위한 fallback
    if (typeof channel.sendTyping === "function") {
      await channel.sendTyping();
    }

    const delay = this._calculateDelay(cleanText);
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

    // 전송 옵션 구성
    const sendOptions = {};
    if (cleanText) sendOptions.content = cleanText;
    if (files.length > 0) sendOptions.files = files;

    const message = await channel.send(sendOptions);

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
