/**
 * Parses the markdown response contract produced by the chat model.
 */
export class AIResponseParser {
  /**
   * @param {string} text
   * @returns {{messages: string[]}}
   */
  parse(text = "") {
    const heading = text.match(/^##[ \t]+messages[ \t]*\r?$/im);
    const messageText = heading
      ? text
          .slice(heading.index + heading[0].length)
          .split(/^##(?:[ \t]|$)/m, 1)[0]
      : text;

    return {
      messages: messageText
        .split("[BREAK]")
        .map((message) => message.trim())
        .filter((message) => message.length > 0),
    };
  }
}
