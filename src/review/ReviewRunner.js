import { randomUUID } from "node:crypto";
import { contractIssues, validateReview } from "./contracts.js";
import { ReviewError } from "./CodexReviewer.js";

export function createRedactor(secrets = []) {
  const values = secrets.filter(
    (value) => typeof value === "string" && value.length >= 8,
  );
  const visit = (value) => {
    if (typeof value === "string") {
      for (const secret of values)
        value = value.replaceAll(secret, "[REDACTED]");
      return value.replace(
        /\b(?:sk-[\w-]{16,}|Bearer\s+[\w.\/-]{12,})/gi,
        "[REDACTED]",
      );
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          /^(?:authorization|headers|apiRequest|system|systemInstruction|apiKey|token|password|secret)$/i.test(
            key,
          )
            ? "[REDACTED]"
            : visit(entry),
        ]),
      );
    return value;
  };
  return visit;
}

export async function withDeadline(operation, signal, timeoutMs = 300_000) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(
    () =>
      controller.abort(
        new ReviewError(
          "timeout",
          "호출이 제한 시간 안에 완료되지 않았습니다.",
        ),
      ),
    timeoutMs,
  );
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  if (controller.signal.aborted) onAbort();
  try {
    controller.signal.throwIfAborted();
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

export class ReviewRunner {
  constructor({
    store,
    reviewer,
    chat,
    timeoutMs = 300_000,
    progress = () => {},
  }) {
    Object.assign(this, { store, reviewer, chat, timeoutMs, progress });
  }

  async evaluate(channel, signal, final = false) {
    const result = await withDeadline(
      (callSignal) =>
        this.reviewer.review(channel, { signal: callSignal, final }),
      signal,
      this.timeoutMs,
    );
    validateReview(result.review, channel.turnCount);
    await this.store.record({
      type: "reviewed",
      channelId: channel.id,
      ...result,
    });
    return result.review.nextMessage;
  }

  async finishTurn(pending, response) {
    // Confirmed headless delivery is evidence even if the DB write was interrupted.
    const seen = new Set(response.messages.map((message) => message.id));
    response.messages.push(
      ...(pending.deliveries ?? []).filter((message) => !seen.has(message.id)),
    );
    if (["PROCESSING", "GENERATED"].includes(response.status))
      response.status = "INTERRUPTED";
    response.contractIssues = contractIssues(response);
    await this.store.record({
      type: "responded",
      turn: {
        channelId: pending.channelId,
        number: pending.number,
        messageId: pending.messageId,
        userMessage: pending.userMessage,
        response,
      },
    });
    this.progress(this.store.state);
  }

  async run({ signal, maxTurns = Infinity } = {}) {
    const { state } = this.store;
    try {
      await this.chat.initialize(state.channels);
      await withDeadline(
        (callSignal) => this.reviewer.initialize({ signal: callSignal }),
        signal,
        this.timeoutMs,
      );
      // Reconcile the durable input with SQLite before making any new API call.
      if (state.pending) {
        signal?.throwIfAborted();
        const recovered = await this.chat.recover(state.pending);
        if (recovered) await this.finishTurn(state.pending, recovered);
      }
      while (state.channels.some((channel) => channel.turnCount < maxTurns)) {
        signal?.throwIfAborted();
        const channel = state.channels[state.cursor];
        if (channel.turnCount >= maxTurns) {
          state.cursor = (state.cursor + 1) % state.channels.length;
          continue;
        }
        if (!state.pending) {
          const nextMessage =
            channel.nextMessage ?? (await this.evaluate(channel, signal));
          signal?.throwIfAborted();
          await this.store.record({
            type: "prepared",
            turn: {
              channelId: channel.id,
              userId: channel.userId,
              userName: channel.userName,
              number: channel.turnCount + 1,
              messageId: randomUUID(),
              userMessage: nextMessage,
            },
          });
        }
        const pending = state.pending;
        const response = await withDeadline(
          (callSignal) => this.chat.send(pending, { signal: callSignal }),
          signal,
          this.timeoutMs,
        );
        await this.finishTurn(pending, response);
      }
      // Bounded smoke runs still evaluate their final replies.
      for (const channel of state.channels) {
        if (channel.evaluatedThrough < channel.turnCount)
          await this.evaluate(channel, signal, true);
      }
      await this.store.record({
        type: "stopped",
        reason: "requested_turns_completed",
      });
    } catch (error) {
      const reason = signal?.aborted
        ? "manual_stop"
        : (error.code ?? "review_failed");
      await this.store.record({ type: "stopped", reason });
      if (reason !== "manual_stop") throw error;
    } finally {
      await this.chat.close();
    }
  }
}
