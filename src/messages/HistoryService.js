import { HistoryMessageFormatter } from "./HistoryMessageFormatter.js";

/** Builds model context from immutable experiences, not the latest message rows. */
export class HistoryService {
  constructor(
    eventRepository,
    messageRepository,
    historyMessageFormatter = new HistoryMessageFormatter(),
  ) {
    this.eventRepository = eventRepository;
    this.messageRepository = messageRepository;
    this.historyMessageFormatter = historyMessageFormatter;
  }

  async fetchHistoryData(channelId, botId, rerollGenerationId = null) {
    const snapshot = await this.eventRepository.snapshot(
      channelId,
      rerollGenerationId,
    );
    const livePending = snapshot.events.filter(
      (event) =>
        event.id > snapshot.fromExclusive && this.isInput(event, botId),
    );
    const replayEvents = snapshot.replay?.events ?? [];
    const replayIds = new Set(replayEvents.map((event) => event.id));
    const events = [
      ...replayEvents,
      ...snapshot.events.filter((event) => !replayIds.has(event.id)),
    ];
    events.sort((a, b) => a.id - b.id);
    const pendingIds = new Set(livePending.map((event) => event.id));
    for (const event of replayEvents) {
      if (snapshot.replay.inputEventIds.includes(event.id))
        pendingIds.add(event.id);
    }
    const imageRecords = events.map((event) => ({
      attachmentsJson: event.snapshotAttachmentsJson,
    }));
    const generationIds =
      this.historyMessageFormatter.extractGeneratedImageGenerationIds(
        imageRecords,
      );
    const imagePrompts =
      await this.messageRepository.findGenerationInputsByIds(generationIds);
    const rendered = events.map((event) => this.render(event, imagePrompts));
    // Context placement follows delivery; input handling still follows the cursor.
    const boundary =
      events.findLast(
        (event) => event.kind === "SENT" && event.authorPlatformId === botId,
      )?.id ?? 0;
    const pendingMessages = rendered.filter(
      (event) => event.eventId > boundary,
    );
    const historyMessages = rendered.filter(
      (event) => event.eventId <= boundary,
    );
    const input = rendered.filter((event) => pendingIds.has(event.eventId));
    return {
      historyMessages,
      pendingMessages,
      messageIds: input.map((message) => message.id),
      inputMessages: input.map((message) => message.content),
      eventSnapshot: {
        ...snapshot,
        replay: undefined,
        events,
        inputEventIds: [...pendingIds],
      },
    };
  }

  isInput(event, botId) {
    return (
      event.source === "LIVE" &&
      !event.isBot &&
      event.authorPlatformId !== botId &&
      ["READ", "EDIT", "DELETE"].includes(event.kind)
    );
  }

  render(event, imagePrompts) {
    const body = this.historyMessageFormatter.renderContentForAI(
      {
        content: event.snapshotContent,
        attachmentsJson: event.snapshotAttachmentsJson,
      },
      imagePrompts,
    );
    let content = body;
    if (event.kind === "EDIT") {
      content =
        "[수정 목격]\n" +
        (event.previousContent !== null
          ? `이전에 읽은 내용: ${JSON.stringify(event.previousContent)}\n`
          : "이전에 읽은 내용: 미상\n") +
        `현재 내용: ${JSON.stringify(body)}`;
    } else if (event.kind === "DELETE") {
      content =
        `[삭제 목격${event.batchId ? `; 일괄 삭제 ${event.batchId}` : ""}]\n` +
        (event.snapshotContent !== null
          ? `이전에 읽은 내용: ${JSON.stringify(body)}`
          : "이전에 읽은 내용: 미상") +
        "\n삭제 실행자와 이유는 알 수 없음.";
    } else if (event.source === "HISTORY") {
      content = `[현재 과거 내역에서 읽은 메시지${event.editedAt ? "; 수정됨 표시 있음, 편집 시점은 목격하지 않음" : ""}]\n${body}`;
    } else if (event.kind === "READ" && event.editedAt) {
      content = `[수정됨 표시 있음]\n${body}`;
    }
    return {
      id: event.messageId,
      eventId: event.id,
      authorId: event.authorId,
      authorPlatformId:
        event.source !== "HISTORY" &&
        (event.kind === "SENT" || event.kind === "READ")
          ? event.authorPlatformId
          : null,
      content,
      createdAt: event.observedAt,
    };
  }
}
