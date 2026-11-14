// A portable estimate, not a provider tokenizer. Provider-added retrieval is separate.
export const estimateDecisionTokens = (value) =>
  Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 3);

export class DecisionContext {
  constructor(eventRepository, settings, characterId, conversationPolicy) {
    Object.assign(this, {
      eventRepository,
      settings,
      characterId,
      conversationPolicy,
    });
  }

  async build(request, batch, assistant, signal) {
    const replyIds = [
      ...new Set(
        [...batch.metadata.values()]
          .map((m) => m.replyToMessageId)
          .filter(Boolean),
      ),
    ];
    const { events, lastSentId } = await this.eventRepository.decisionContext(
      request.internalChannelId,
      request.botId,
      this.settings.maxContextMessages,
      replyIds,
    );
    signal.throwIfAborted();
    const lastSent = events.find((event) => event.id === lastSentId);
    const state = {
      characterId: this.characterId,
      character: this.settings.character,
      participationRules: this.settings.rules,
      botId: request.botId,
      assistant,
      lastSpokeMsAgo: lastSent
        ? Math.max(0, Date.now() - new Date(lastSent.observedAt).getTime())
        : null,
      silenceMs: Math.max(0, performance.now() - batch.lastAt),
      waitRecheck: batch.rechecks > 0,
      omittedMessages: batch.omitted,
      messages: [],
    };
    const messages = events.map((event) => {
      const metadata = batch.metadata.get(event.platformMessageId);
      return {
        eventId: event.id,
        messageId: event.platformMessageId,
        authorId: event.authorPlatformId,
        authorName: event.authorDisplayName ?? event.authorHandle,
        kind: event.kind,
        source: event.source,
        sentAt: event.sentAt,
        observedAt: event.observedAt,
        content: event.snapshotContent ?? "",
        previousContent:
          event.kind === "EDIT" ? event.previousContent : undefined,
        hasAttachments: !!event.snapshotAttachmentsJson,
        isNew:
          event.source === "LIVE" &&
          event.id > batch.throughEventId &&
          batch.ids.has(event.platformMessageId),
        inCurrentResponse:
          assistant.active && event.id <= assistant.inputThroughEventId,
        mentionedUserIds:
          metadata?.mentionedUserIds ??
          [...(event.snapshotContent ?? "").matchAll(/<@!?(\d+)>/g)].map(
            (match) => match[1],
          ),
        replyToMessageId: metadata?.replyToMessageId,
        isReplyTarget: replyIds.includes(event.platformMessageId),
      };
    });
    // References outside the observed window are read through the authorized port.
    for (const id of replyIds) {
      if (
        messages.some((message) => message.messageId === id) ||
        !request.channelPort.readMessage
      )
        continue;
      if (
        this.conversationPolicy &&
        !(await this.conversationPolicy.isEnabled(request.channelPort))
      )
        break;
      signal.throwIfAborted();
      try {
        const reply = await request.channelPort.readMessage(id);
        signal.throwIfAborted();
        messages.push({
          messageId: id,
          authorId: reply.author.platformUserId,
          authorName: reply.author.displayName ?? reply.author.handle,
          content: reply.content,
          sentAt: reply.sentAt,
          isNew: false,
          isReplyTarget: true,
          source: "REFERENCE",
        });
      } catch (error) {
        signal.throwIfAborted();
        // A deleted/inaccessible target is not invented or read via another account.
        messages.push({
          messageId: id,
          isReplyTarget: true,
          unavailable: true,
          isNew: false,
        });
      }
    }
    const newest = messages.filter((message) => message.isNew).at(-1);
    const priority = (message) =>
      message === newest
        ? 4
        : message.isReplyTarget || message.eventId === lastSentId
          ? 3
          : message.isNew
            ? 2
            : 1;
    messages.sort(
      (a, b) =>
        priority(b) - priority(a) || (b.eventId ?? 0) - (a.eventId ?? 0),
    );
    const budget = this.settings.maxContextTokens;
    // Reserve the budget for actual observations even when a long description is configured.
    state.character = state.character.slice(0, Math.floor(budget / 4));
    state.participationRules = state.participationRules.slice(
      0,
      Math.floor(budget / 4),
    );
    for (const original of messages) {
      const message = { ...original };
      // One long message must leave room for the last reply and its reference.
      const fits = () =>
        estimateDecisionTokens(message) <=
          Math.max(256, Math.floor(budget / 3)) &&
        estimateDecisionTokens({
          ...state,
          messages: [...state.messages, message],
        }) <=
          budget - 32;
      if (!fits()) {
        message.truncated = true;
        const content = message.content ?? "";
        message.previousContent = undefined;
        message.content = "";
        if (!fits()) {
          state.omittedMessages += 1;
          continue;
        }
        let low = 0,
          high = content.length;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          message.content = content.slice(0, mid);
          if (fits()) low = mid;
          else high = mid - 1;
        }
        message.content = content.slice(0, low);
      }
      state.messages.push(message);
    }
    state.messages.sort((a, b) => (a.eventId ?? 0) - (b.eventId ?? 0));
    return {
      state,
      throughEventId: Math.max(
        batch.throughEventId,
        ...events.map((event) => event.id),
      ),
    };
  }
}
