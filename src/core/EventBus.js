import { EventEmitter } from "node:events";
import { createLogger } from "./logger.js";

const logger = createLogger("EventBus");

export const AppEvents = Object.freeze({
  GenerationStarted: "generation.started",
  GenerationCancelled: "generation.cancelled",
  GenerationCompleted: "generation.completed",
  GenerationFailed: "generation.failed",
  GenerationServiceUnavailable: "generation.serviceUnavailable",
});

/**
 * Small async event bus for side effects and observability.
 *
 * Core control flow should still be explicit in the caller. Listeners are run
 * sequentially so handler order stays predictable.
 */
export class EventBus {
  constructor({ eventLogger = logger } = {}) {
    this.emitter = new EventEmitter();
    this.logger = eventLogger;
  }

  on(eventName, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("EventBus listener must be a function.");
    }

    this.emitter.on(eventName, listener);
    return () => this.off(eventName, listener);
  }

  off(eventName, listener) {
    this.emitter.off(eventName, listener);
  }

  listenerCount(eventName) {
    return this.emitter.listenerCount(eventName);
  }

  removeAllListeners(eventName) {
    this.emitter.removeAllListeners(eventName);
  }

  async emitAsync(eventName, payload = {}) {
    const listeners = this.emitter.listeners(eventName);
    const errors = [];

    for (const listener of listeners) {
      try {
        await listener(payload);
      } catch (error) {
        errors.push(error);
        this.logger.error({ err: error, eventName }, "Event listener failed");
      }
    }

    return {
      listenerCount: listeners.length,
      errors,
    };
  }
}
