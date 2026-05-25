import { createLogger } from "../core/logger.js";

const logger = createLogger("AIResponseParser");

/**
 * Parses the markdown response contract produced by the chat model.
 */
export class AIResponseParser {
  /**
   * @param {string} text
   * @returns {{messages: string[], emotionDelta: Object, emotionReason: string, relationshipDelta: Object}}
   */
  parse(text = "") {
    try {
      const parsed = {
        messages: [],
        emotionDelta: {},
        emotionReason: "",
        relationshipDelta: {},
      };

      const messagesMatch = text.match(/## messages\s*\n([\s\S]*?)(?=\n##|$)/i);
      const emotionDeltaMatch = text.match(
        /## emotion_delta\s*\n([\s\S]*?)(?=\n##|$)/i,
      );
      const emotionReasonMatch = text.match(
        /## emotion_reason\s*\n([\s\S]*?)(?=\n##|$)/i,
      );
      const relationshipDeltaMatch = text.match(
        /## relationship_delta\s*\n([\s\S]*?)(?=\n##|$)/i,
      );

      if (messagesMatch) {
        parsed.messages = messagesMatch[1]
          .split("[BREAK]")
          .map((message) => message.trim())
          .filter((message) => message.length > 0);
      } else {
        parsed.messages = [text.trim()];
      }

      this._parseKeyValueLines(emotionDeltaMatch, parsed.emotionDelta);
      this._parseKeyValueLines(
        relationshipDeltaMatch,
        parsed.relationshipDelta,
      );

      if (emotionReasonMatch) {
        parsed.emotionReason = emotionReasonMatch[1].trim();
      }

      return parsed;
    } catch (error) {
      logger.warn(
        { err: error },
        "Failed to parse AI response as Markdown, using raw text",
      );
      return {
        messages: [text.trim()],
        emotionDelta: {},
        emotionReason: "",
        relationshipDelta: {},
      };
    }
  }

  _parseKeyValueLines(matchResult, target) {
    if (!matchResult) return;

    const lines = matchResult[1].trim().split("\n");
    for (const line of lines) {
      const [key, value] = line.split(":");
      if (key && value) {
        target[key.trim()] = parseInt(value.trim(), 10) || 0;
      }
    }
  }
}
