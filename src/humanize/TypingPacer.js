/** Calculates a delay without waiting or reading configuration. */
export class TypingPacer {
  calculate(text, { min, max, perChar }) {
    return Math.min(max, Math.max(min, text.length * perChar));
  }
}
