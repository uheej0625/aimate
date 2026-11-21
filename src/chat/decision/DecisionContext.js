// A portable estimate, not a provider tokenizer. Provider-added retrieval is separate.
export const estimateDecisionTokens = (value) =>
  Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 3);

export class DecisionContext {
  constructor(eventRepository, settings, conversationPolicy) {
    Object.assign(this, {
      eventRepository,
      settings,
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
      character: this.settings.character,
      participationRules: this.settings.rules,
      isDirect: request.channelPort.isDirect === true,
      assistant: { active: assistant.active },
      lastSpokeMsAgo: lastSent
        ? Math.max(0, Date.now() - new Date(lastSent.observedAt).getTime())
        : null,
      silenceMs: Math.max(0, Math.floor(performance.now() - batch.lastAt)),
      recheckCount: batch.rechecks,
      omittedMessages: batch.omitted,
      messages: [],
    };
    const observedMessageIds = new Set(
      events.map((event) => event.platformMessageId),
    );
    const messageRefs = new Map(
      [...new Set([...observedMessageIds, ...replyIds])].map((id, index) => [
        id,
        index + 1,
      ]),
    );
    const replyRefs = new Set(replyIds.map((id) => messageRefs.get(id)));
    const messages = events.map((event) => {
      const metadata = batch.metadata.get(event.platformMessageId);
      const mentionedUserIds =
        metadata?.mentionedUserIds ??
        [...(event.snapshotContent ?? "").matchAll(/<@!?(\d+)>/g)].map(
          (match) => match[1],
        );
      return {
        eventId: event.id,
        message: {
          ref: messageRefs.get(event.platformMessageId),
          authorId: event.authorPlatformId,
          authorName: event.authorDisplayName ?? event.authorHandle,
          isAssistant: event.authorPlatformId === request.botId,
          kind: ["EDIT", "DELETE"].includes(event.kind)
            ? event.kind
            : undefined,
          sentAt: event.sentAt,
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
          mentionedUserIds: mentionedUserIds.length
            ? mentionedUserIds
            : undefined,
          mentionsAssistant:
            mentionedUserIds.includes(request.botId) || undefined,
          replyTo: messageRefs.get(metadata?.replyToMessageId),
        },
      };
    });
    // References outside the observed window are read through the authorized port.
    for (const id of replyIds) {
      if (observedMessageIds.has(id) || !request.channelPort.readMessage)
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
          eventId: 0,
          message: {
            ref: messageRefs.get(id),
            authorId: reply.author.platformUserId,
            authorName: reply.author.displayName ?? reply.author.handle,
            isAssistant: reply.author.platformUserId === request.botId,
            content: reply.content,
            sentAt: reply.sentAt,
            isNew: false,
          },
        });
      } catch (error) {
        signal.throwIfAborted();
        // A deleted/inaccessible target is not invented or read via another account.
        messages.push({
          eventId: 0,
          message: {
            ref: messageRefs.get(id),
            unavailable: true,
            isNew: false,
          },
        });
      }
    }
    const newest = messages.findLast(({ message }) => message.isNew);
    const priority = (row) =>
      row === newest
        ? 4
        : replyRefs.has(row.message.ref) || row.eventId === lastSentId
          ? 3
          : row.message.isNew
            ? 2
            : 1;
    messages.sort((a, b) => priority(b) - priority(a) || b.eventId - a.eventId);
    const budget = this.settings.maxContextTokens;
    // Reserve the budget for actual observations even when a long description is configured.
    state.character = state.character.slice(0, Math.floor(budget / 4));
    state.participationRules = state.participationRules.slice(
      0,
      Math.floor(budget / 4),
    );
    const included = [];
    for (const { eventId, message } of messages) {
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
      included.push({ eventId, message });
    }
    included.sort((a, b) => a.eventId - b.eventId);
    state.messages = included.map(({ message }) => message);
    return {
      state,
      throughEventId: Math.max(
        batch.throughEventId,
        ...events.map((event) => event.id),
      ),
    };
  }
}
