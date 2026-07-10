import { createLogger } from "../../core/logger.js";

const logger = createLogger("AIResponseParser");

/**
 * Parses the markdown response contract produced by the chat model.
 */
export class AIResponseParser {
  /**
   * @param {string} text
   * @returns {{messages: string[]}}
   */
  parse(text = "") {
    try {
      const messagesMatch = text.match(/## messages\s*\n([\s\S]*?)(?=\n##|$)/i);
      const messageText = messagesMatch ? messagesMatch[1] : text;

      return {
        messages: messageText
          .split("[BREAK]")
          .map((message) => message.trim())
          .filter((message) => message.length > 0),
      };
    } catch (error) {
      logger.warn(
        { err: error },
        "Failed to parse AI response as Markdown, using raw text",
      );
      return {
        messages: [text.trim()],
      };
    }
  }
}
