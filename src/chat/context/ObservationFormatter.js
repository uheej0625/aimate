/** Formats the selected event stream without changing its order or stored text. */
export class ObservationFormatter {
  constructor({ resolver, botId, showNames, timeZone, language = "ko-KR" }) {
    this.resolver = resolver;
    this.botId = botId;
    this.showNames = showNames;
    this.dateFormatter = new Intl.DateTimeFormat(language, {
      timeZone,
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    this.dayFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    this.timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    this.previous = null;
    this.lastUserDay = null;
  }

  format(message) {
    const role =
      message.role ??
      (message.authorPlatformId === this.botId ? "assistant" : "user");
    const body = this.resolver.replaceMentions(message.content);
    const content =
      message.channelMessageNo != null
        ? `#${message.channelMessageNo} ${body}`
        : body;
    const previous = this.previous;
    this.previous = message;
    // Keep fixed references for tools, but do not teach the model to emit headers.
    if (role === "assistant") return { role, content };

    const time = timestamp(message.sentAt);
    const previousTime = timestamp(previous?.sentAt);
    const day = time ? this.dayFormatter.format(time) : null;
    const newDay = day && day !== this.lastUserDay;
    const observation =
      message.kind === "EDIT" ||
      message.kind === "DELETE" ||
      message.source === "HISTORY";
    const newGroup =
      !previous ||
      newDay ||
      observation ||
      !message.authorPlatformId ||
      previous.kind === "EDIT" ||
      previous.kind === "DELETE" ||
      previous.source === "HISTORY" ||
      previous.authorPlatformId !== message.authorPlatformId ||
      previous.role === "assistant" ||
      !previousTime ||
      (time && time - previousTime >= 7 * 60 * 1000);
    const lines = [];
    if (newDay) {
      lines.push(`--- ${this.dateFormatter.format(time)} ---`);
      this.lastUserDay = day;
    }
    if (newGroup) {
      const name = this.showNames
        ? (this.resolver.get(message.authorPlatformId)?.label ??
          "알 수 없는 사용자")
        : "";
      const header = [
        time ? `[${this.timeFormatter.format(time)}]` : "",
        name && (observation ? `대상 작성자: ${name}` : name),
      ]
        .filter(Boolean)
        .join(" ");
      if (header) lines.push(header);
    }
    lines.push(content);
    return { role, content: lines.join("\n") };
  }
}

function timestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
