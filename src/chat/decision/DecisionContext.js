import { ObservationFormatter } from "../context/ObservationFormatter.js";
import { ParticipantResolver } from "../context/ParticipantResolver.js";

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

// A portable estimate, not a provider tokenizer. Provider-added retrieval is separate.
export const estimateDecisionTokens = (value) =>
  Math.ceil(jsonBytes(value) / 3);

function fittingPrefix(text, fits) {
  let low = 0,
    high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(text.slice(0, mid))) low = mid;
    else high = mid - 1;
  }
  // A UTF-16 cut must not leave half an emoji in the model input.
  return text.slice(0, low).replace(/[\uD800-\uDBFF]$/u, "");
}

export class DecisionContext {
  constructor(eventRepository, settings, conversationPolicy, display = {}) {
    Object.assign(this, {
      eventRepository,
      settings,
      conversationPolicy,
      display,
    });
  }

  async build(request, batch, assistant, signal) {
    const pendingReplyIds = [
      ...new Set(
        [...batch.ids]
          .map((id) => batch.metadata.get(id)?.replyToMessageId)
          .filter(Boolean),
      ),
    ];
    const { events, lastSentId } = await this.eventRepository.decisionContext(
      request.internalChannelId,
      request.botId,
      this.settings.maxContextMessages,
      pendingReplyIds,
    );
    signal.throwIfAborted();
    const observedIds = new Set(events.map((event) => event.platformMessageId));
    const targets = await this.readTargets(
      request.channelPort,
      pendingReplyIds.filter((id) => !observedIds.has(id)),
      signal,
    );
    signal.throwIfAborted();
    const observations = [...targets, ...events];
    const refs = new Map();
    for (const event of events) {
      const target = batch.metadata.get(
        event.platformMessageId,
      )?.replyToMessageId;
      if (target && !refs.has(target)) refs.set(target, refs.size + 1);
    }
    const resolver = new ParticipantResolver([
      { id: request.botId, displayName: "봇" },
      ...observations.map((event) => ({
        id: event.authorPlatformId,
        displayName: event.authorDisplayName,
        handle: event.authorHandle,
      })),
    ]);
    const formatter = new ObservationFormatter({
      ...this.display,
      botId: request.botId,
      showNames: Boolean(request.channelRecord?.serverId),
      resolver,
    });
    const lastSent = events.find((event) => event.id === lastSentId);
    const budget = this.settings.maxContextTokens;
    const description = (text) =>
      fittingPrefix(
        text.slice(0, Math.floor(budget / 4)),
        (prefix) => jsonBytes(prefix) <= (budget * 3) / 4,
      );
    const state = {
      character: description(this.settings.character),
      participationRules: description(this.settings.rules),
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
    const rows = observations.map((event) => {
      const id = event.platformMessageId;
      const metadata = event.id ? batch.metadata.get(id) : undefined;
      const isNew =
        event.source === "LIVE" &&
        event.id > batch.throughEventId &&
        batch.ids.has(id);
      const tags = [];
      if (isNew) tags.push("새 입력");
      if (
        event.id > 0 &&
        assistant.active &&
        event.id <= assistant.inputThroughEventId
      )
        tags.push("현재 답변에 포함");
      if (event.source === "HISTORY") tags.push("과거 조회");
      if (event.kind === "EDIT") tags.push("수정");
      if (event.kind === "DELETE") tags.push("삭제");
      if (event.snapshotAttachmentsJson || event.hasAttachments)
        tags.push("첨부");
      const raw = event.snapshotContent ?? "";
      const mentionsBot =
        metadata?.mentionedUserIds?.includes(request.botId) ||
        raw.includes(`<@${request.botId}>`) ||
        raw.includes(`<@!${request.botId}>`);
      if (mentionsBot) tags.push("봇 멘션");
      const details = {};
      if (tags.length) details.tags = tags;
      if (metadata?.replyToMessageId)
        details.replyTo = `#${refs.get(metadata.replyToMessageId)}`;
      if (event.kind === "EDIT" && event.previousContent != null)
        details.previousContent = resolver.replaceMentions(
          event.previousContent,
        );
      return {
        ...event,
        channelMessageNo: refs.get(id),
        content: resolver.replaceMentions(raw),
        details,
        isNew,
      };
    });
    const newest = rows.findLast((row) => row.isNew);
    const priority = (row) => {
      if (row === newest) return 3;
      if (row.channelMessageNo || row.id === lastSentId) return 2;
      return row.isNew ? 1 : 0;
    };
    rows.sort((a, b) => priority(b) - priority(a) || b.id - a.id);

    // Budget each observation with its full header. Removing a neighbour can then
    // never leave a retained message without its speaker or push it over budget.
    let remaining =
      budget * 3 -
      jsonBytes({ ...state, omittedMessages: batch.omitted + rows.length });
    const included = [];
    for (const row of rows) {
      formatter.reset();
      const header = formatter.format(row, "");
      const limit = Math.min(
        remaining - 1,
        Math.max(256, Math.floor(budget / 3)) * 3,
      );
      const size = (content) =>
        jsonBytes({
          ...header,
          content: header.content + content,
          ...row.details,
        });
      if (size(row.content) > limit) {
        row.details.tags = [...(row.details.tags ?? []), "일부 생략"];
        delete row.details.previousContent;
        if (size("") > limit) {
          state.omittedMessages++;
          continue;
        }
        row.content = fittingPrefix(
          row.content,
          (prefix) => size(prefix) <= limit,
        );
      }
      remaining -= size(row.content) + 1;
      included.push(row);
    }
    const visibleRefs = new Set(
      included
        .filter((row) => row.channelMessageNo)
        .map((row) => `#${row.channelMessageNo}`),
    );
    const visibleReplies = new Set(included.map((row) => row.details.replyTo));
    formatter.reset();
    state.messages = included
      .sort((a, b) => a.id - b.id)
      .map((row) => {
        if (!visibleReplies.has(`#${row.channelMessageNo}`))
          row.channelMessageNo = undefined;
        if (row.details.replyTo && !visibleRefs.has(row.details.replyTo))
          row.details.replyTo = "?";
        return { ...formatter.format(row, row.content), ...row.details };
      });
    return {
      state,
      throughEventId: Math.max(
        batch.throughEventId,
        ...events.map((event) => event.id),
      ),
    };
  }

  async readTargets(channel, ids, signal) {
    const targets = [];
    for (const id of ids) {
      if (
        !channel.readMessage ||
        (this.conversationPolicy &&
          !(await this.conversationPolicy.isEnabled(channel)))
      )
        break;
      signal.throwIfAborted();
      try {
        const reply = await channel.readMessage(id);
        targets.push({
          id: 0,
          platformMessageId: id,
          source: "HISTORY",
          sentAt: reply.sentAt,
          authorPlatformId: reply.author.platformUserId,
          authorDisplayName: reply.author.displayName,
          authorHandle: reply.author.handle,
          snapshotContent: reply.content,
          hasAttachments: Boolean(reply.attachments?.length),
        });
      } catch {
        // An inaccessible target is marked unknown on the reply itself.
      }
      signal.throwIfAborted();
    }
    return targets;
  }
}
