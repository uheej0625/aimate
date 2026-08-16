import { AppEvents } from "../core/EventBus.js";

/**
 * Registers memory extraction after successful chat generations.
 */
export function registerMemoryPolicy({ eventBus, memoryExtractor }) {
  eventBus.on(AppEvents.GenerationCompleted, async (payload) => {
    await memoryExtractor.extractFromGeneration(payload);
  });
}
