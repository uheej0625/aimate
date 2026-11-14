import { randomUUID } from "node:crypto";

/** Serializes short conversation transitions, never model calls or delivery. */
export class ConversationSession {
  constructor({
    now = () => performance.now(),
    watchDuration = 10 * 60_000,
  } = {}) {
    this.now = now;
    this.watchDuration = watchDuration;
    this.states = new Map();
    this.queues = new Map();
  }

  key(channel) {
    return JSON.stringify([channel.platform, channel.platformChannelId]);
  }

  run(key, operation) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.catch(() => {});
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return result;
  }

  isWatching(key, at = this.now()) {
    const state = this.states.get(key);
    return (
      !!state && at >= state.startedAt && (state.active || at < state.until)
    );
  }

  begin(key, at = this.now()) {
    const previous = this.states.get(key);
    const turnId = randomUUID();
    this.states.set(key, {
      turnId,
      startedAt: this.isWatching(key, at) ? previous.startedAt : at,
      active: true,
      deliveryVersion: previous?.deliveryVersion ?? 0,
    });
    return turnId;
  }

  /** Observe new input without invalidating the currently generating turn. */
  observe(key, at = this.now()) {
    const previous = this.states.get(key);
    this.states.set(key, {
      ...previous,
      startedAt: this.isWatching(key, at) ? previous.startedAt : at,
      until: at + this.watchDuration,
      active: previous?.active ?? false,
    });
  }

  decisionState(key) {
    const state = this.states.get(key);
    return {
      turnId: state?.turnId ?? null,
      active: state?.active ?? false,
      inputThroughEventId: state?.inputThroughEventId ?? 0,
      deliveryVersion: state?.deliveryVersion ?? 0,
    };
  }

  recordInput(key, turnId, throughEventId) {
    if (this.isCurrent(key, turnId))
      this.states.get(key).inputThroughEventId = throughEventId;
  }

  recordDelivery(key, turnId) {
    if (this.isCurrent(key, turnId)) this.states.get(key).deliveryVersion += 1;
  }

  isCurrent(key, turnId) {
    const state = this.states.get(key);
    return state?.active === true && state.turnId === turnId;
  }

  settle(key, turnId, endedAt = this.now()) {
    if (!this.isCurrent(key, turnId)) return;
    const state = this.states.get(key);
    this.states.set(key, {
      ...state,
      active: false,
      until: endedAt + this.watchDuration,
    });
  }

  stop(key) {
    this.states.delete(key);
  }

  clearAll() {
    this.states.clear();
  }
}
