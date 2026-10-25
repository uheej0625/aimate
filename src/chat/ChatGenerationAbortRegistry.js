import { createLogger } from "../core/logger.js";

const logger = createLogger("ChatGenerationAbortRegistry");

/**
 * Tracks active chat model requests so a newer message can interrupt them.
 */
export class ChatGenerationAbortRegistry {
  constructor() {
    this.entries = new Map();
  }

  register(channelId, generationId) {
    const controller = new AbortController();
    let generations = this.entries.get(channelId);

    if (!generations) {
      generations = new Map();
      this.entries.set(channelId, generations);
    }

    generations.set(generationId, controller);
    return controller.signal;
  }

  abortChannel(channelId, reason = "superseded") {
    const generations = this.entries.get(channelId);
    if (!generations) return 0;

    this.entries.delete(channelId);

    let count = 0;
    for (const [generationId, controller] of generations) {
      if (!controller.signal.aborted) {
        controller.abort();
        count += 1;
        logger.debug(
          {
            event: "generation.abort_requested",
            channelId,
            generationId,
            reason,
          },
          "Model request abort requested",
        );
      }
    }

    return count;
  }

  /**
   * Abort every active generation across all channels.
   * @returns {number} Number of aborted requests
   */
  abortAll() {
    let count = 0;
    for (const channelId of this.entries.keys()) {
      count += this.abortChannel(channelId, "shutdown");
    }
    return count;
  }

  unregister(channelId, generationId) {
    const generations = this.entries.get(channelId);
    if (!generations) return;

    generations.delete(generationId);
    if (generations.size === 0) {
      this.entries.delete(channelId);
    }
  }
}
