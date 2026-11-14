import { createLogger } from "../../core/logger.js";

const logger = createLogger("DecisionBuffer");

/** One decision per channel, outside the receive-order queue. */
export class DecisionBuffer {
  mode = "decision";
  buffers = new Map();
  tasks = new Set();

  constructor({
    chatFlow,
    conversationSession,
    contextBuilder,
    decider,
    settings,
    generationAbortRegistry,
    generationLifecycle,
    generationRepository,
    conversationPolicy,
  }) {
    Object.assign(this, {
      chatFlow,
      conversationSession,
      contextBuilder,
      decider,
      settings,
      generationAbortRegistry,
      generationLifecycle,
      generationRepository,
      conversationPolicy,
    });
  }

  add(request) {
    const key = this.conversationSession.key(request.channelPort);
    let entry = this.buffers.get(key);
    if (!entry) {
      entry = {
        revision: 0,
        ids: new Set(),
        metadata: new Map(),
        throughEventId: 0,
        omitted: 0,
      };
      this.buffers.set(key, entry);
    }
    entry.request = request;
    entry.revision += 1;
    entry.lastAt = performance.now();
    entry.firstAt ??= entry.lastAt;
    entry.dirty = true;
    entry.rechecks = 0;
    clearTimeout(entry.timer);
    for (const id of request.changedMessageIds ?? []) {
      entry.ids.delete(id);
      entry.ids.add(id);
    }
    if (request.message) {
      const { platformMessageId, mentionedUserIds, replyToMessageId } =
        request.message;
      entry.metadata.delete(platformMessageId);
      entry.metadata.set(platformMessageId, {
        mentionedUserIds,
        replyToMessageId,
      });
    }
    while (entry.ids.size > this.settings.maxContextMessages) {
      entry.ids.delete(entry.ids.values().next().value);
      entry.omitted += 1;
    }
    while (entry.metadata.size > this.settings.maxContextMessages)
      entry.metadata.delete(entry.metadata.keys().next().value);
    this.schedule(key, entry);
  }

  schedule(key, entry, delay) {
    if (entry.running || !entry.dirty || this.buffers.get(key) !== entry)
      return;
    clearTimeout(entry.timer);
    const now = performance.now();
    delay ??= Math.max(
      0,
      Math.min(
        entry.lastAt + this.settings.debounceMs,
        (entry.firstAt ?? now) + this.settings.maxWaitMs,
      ) - now,
    );
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const task = this.run(key, entry);
      this.tasks.add(task);
      void task.finally(() => this.tasks.delete(task));
    }, delay);
  }

  async run(key, entry) {
    if (entry.running || this.buffers.get(key) !== entry) return;
    entry.running = true;
    entry.controller = new AbortController();
    const session = this.conversationSession;
    let retryDelay;
    let revision = entry.revision;
    let generation, result, failure;
    let application = { applied: false, reason: "cancelled" };
    const startedAt = performance.now();
    try {
      const snapshot = await session.run(key, async () => {
        if (!(await this.enabled(key, entry))) return null;
        revision = entry.revision;
        entry.firstAt = null;
        return {
          assistant: session.decisionState(key),
          batch: {
            ids: new Set(entry.ids),
            metadata: new Map(entry.metadata),
            throughEventId: entry.throughEventId,
            rechecks: entry.rechecks,
            lastAt: entry.lastAt,
            omitted: entry.omitted,
          },
          request: entry.request,
        };
      });
      if (!snapshot) return;
      const context = await this.contextBuilder.build(
        snapshot.request,
        snapshot.batch,
        snapshot.assistant,
        entry.controller.signal,
      );
      entry.controller.signal.throwIfAborted();
      generation = await this.generationRepository.create({
        channelId: snapshot.request.internalChannelId,
        type: "DECISION",
        prompt: this.decider.settings.prompt,
        status: "PROCESSING",
        input: JSON.stringify({
          state: context.state,
          throughEventId: context.throughEventId,
        }),
      });
      result = await this.decider.evaluate(
        context.state,
        entry.controller.signal,
        (apiRequest) =>
          this.generationRepository.updateDetails(generation.id, {
            apiRequest,
          }),
      );
      const { action } = result;
      const next = await session.run(key, async () => {
        if (!(await this.enabled(key, entry))) {
          application.reason = entry.cancelReason ?? "cancelled";
          return null;
        }
        if (
          entry.revision !== revision ||
          JSON.stringify(session.decisionState(key)) !==
            JSON.stringify(snapshot.assistant)
        ) {
          application.reason =
            entry.revision !== revision ? "new_input" : "assistant_changed";
          entry.firstAt ??= performance.now();
          logger.debug(
            {
              event: "decision.stale",
              channelId: entry.request.internalChannelId,
            },
            "Stale decision discarded",
          );
          return null;
        }
        application.reason = "apply_failed";
        entry.dirty = false;
        const { request, assistant } = snapshot;
        if (["stop", "wait"].includes(action) && assistant.active) {
          session.settle(key, assistant.turnId);
          this.generationAbortRegistry.abortChannel(request.internalChannelId);
          await this.generationLifecycle.cancelActiveForChannel(
            request.internalChannelId,
          );
        }
        if (action === "wait") {
          if (entry.rechecks === 0) {
            entry.rechecks = 1;
            entry.dirty = true;
            retryDelay = this.settings.recheckMs;
          }
          application = { applied: true, reason: null };
          return null;
        }
        // This cursor only belongs to decisions, not generation/input persistence.
        entry.throughEventId = context.throughEventId;
        entry.ids.clear();
        entry.omitted = 0;
        if (["respond", "restart"].includes(action)) {
          const turnId = session.begin(key);
          this.generationAbortRegistry.abortChannel(request.internalChannelId);
          application = { applied: true, reason: null, turnId };
          return {
            channelPort: request.channelPort,
            internalChannelId: request.internalChannelId,
            botId: request.botId,
            turnId,
          };
        }
        application = { applied: true, reason: null };
        return null;
      });
      if (next)
        void this.chatFlow
          .execute(next)
          .catch((error) => this.logFailure(error, entry));
    } catch (error) {
      failure = { name: error.name, statusCode: error.statusCode };
      if (!result)
        application.reason = entry.controller.signal.aborted
          ? (entry.cancelReason ?? "cancelled")
          : error.name === "TimeoutError"
            ? "timeout"
            : "failed";
      if (!entry.controller.signal.aborted) {
        this.logFailure(error, entry);
        // Preserve active generation; retry only when newer input has arrived.
        if (entry.revision === revision) entry.dirty = false;
      }
    } finally {
      if (generation) {
        try {
          await this.generationRepository.updateDetailsAndStatusIfCurrent(
            generation.id,
            ["PROCESSING", "CANCELLED"],
            result
              ? "COMPLETED"
              : entry.controller.signal.aborted
                ? "CANCELLED"
                : "FAILED",
            {
              output: result
                ? JSON.stringify({
                    action: result.action,
                    probabilities: result.probabilities,
                  })
                : undefined,
              apiResponse: result?.apiResponse,
              metadata: {
                provider: this.decider.settings.provider,
                model: this.decider.settings.model,
                usage: result?.usage,
                durationMs: result?.durationMs ?? performance.now() - startedAt,
                application,
                error: failure,
                timings: { completedAt: new Date().toISOString() },
              },
            },
          );
        } catch (error) {
          logger.warn(
            {
              event: "decision.persistence.failed",
              generationId: generation.id,
              channelId: entry.request.internalChannelId,
              errorType: error.name,
            },
            "Failed to persist decision outcome",
          );
        }
      }
      entry.running = false;
      this.schedule(
        key,
        entry,
        entry.revision === revision ? retryDelay : undefined,
      );
    }
  }

  async enabled(key, entry) {
    if (this.buffers.get(key) !== entry || entry.controller.signal.aborted)
      return false;
    if (
      this.conversationPolicy &&
      !(await this.conversationPolicy.isEnabled(entry.request.channelPort))
    ) {
      this.clear(entry.request.channelPort, "channel_disabled");
      return false;
    }
    return this.buffers.get(key) === entry && !entry.controller.signal.aborted;
  }

  logFailure(error, entry) {
    logger.warn(
      {
        event: "decision.failed",
        channelId: entry.request.internalChannelId,
        errorType: error.name,
        statusCode: error.statusCode,
      },
      "Decision failed; awaiting new input",
    );
  }

  has(channel) {
    const entry = this.buffers.get(this.conversationSession.key(channel));
    return !!entry && (entry.dirty || entry.running);
  }

  clear(channel, reason = "cancelled") {
    const key = this.conversationSession.key(channel);
    const entry = this.buffers.get(key);
    if (!entry) return false;
    entry.cancelReason = reason;
    clearTimeout(entry.timer);
    entry.controller?.abort();
    this.buffers.delete(key);
    return true;
  }

  clearAll() {
    for (const entry of this.buffers.values())
      this.clear(entry.request.channelPort);
  }
}
