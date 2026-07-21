import readline from "node:readline";
import { EventEmitter } from "node:events";

const ESC = "\u001b[";
const RESET = `${ESC}0m`;
const COLORS = {
  dim: `${ESC}2m`,
  cyan: `${ESC}38;5;81m`,
  purple: `${ESC}38;5;141m`,
  green: `${ESC}38;5;114m`,
  yellow: `${ESC}38;5;221m`,
  red: `${ESC}38;5;203m`,
  selected: `${ESC}48;5;237m${ESC}38;5;255m`,
  border: `${ESC}38;5;240m`,
};

export function displayWidth(value) {
  return [...String(value)].reduce((width, char) => {
    const code = char.codePointAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return width;
    if (/\p{Mark}/u.test(char) || code === 0xfe0f) return width;
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd);
    return width + (isWide ? 2 : 1);
  }, 0);
}

export function sanitizeText(value) {
  return String(value ?? "")
    .replace(
      /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g,
      "",
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function fitText(value, width, suffix = "…") {
  if (width <= 0) return "";
  const text = sanitizeText(value).replace(/[\r\n]+/g, " ");
  if (displayWidth(text) <= width)
    return text + " ".repeat(width - displayWidth(text));
  const suffixWidth = displayWidth(suffix);
  let result = "";
  let used = 0;
  for (const char of text) {
    const charWidth = displayWidth(char);
    if (used + charWidth + suffixWidth > width) break;
    result += char;
    used += charWidth;
  }
  return result + suffix + " ".repeat(Math.max(0, width - used - suffixWidth));
}

export function wrapText(value, width) {
  if (width < 1) return [""];
  const output = [];
  for (const paragraph of sanitizeText(value).replace(/\r/g, "").split("\n")) {
    if (!paragraph) {
      output.push("");
      continue;
    }
    let line = "";
    let lineWidth = 0;
    for (const char of paragraph) {
      const charWidth = displayWidth(char);
      if (line && lineWidth + charWidth > width) {
        output.push(line);
        line = "";
        lineWidth = 0;
      }
      line += char;
      lineWidth += charWidth;
    }
    output.push(line);
  }
  return output.length ? output : [""];
}

function border(left, fill, right, width) {
  return `${COLORS.border}${left}${fill.repeat(Math.max(0, width - 2))}${right}${RESET}`;
}

export function renderStatusLine({ status, color, width }) {
  const hints =
    width >= 80
      ? "Tab 패널  Ctrl+N 새 채팅  PgUp/PgDn 스크롤  Ctrl+Q 종료"
      : width >= 56
        ? "Tab 패널  Ctrl+N 새 채팅  Ctrl+Q 종료"
        : "Ctrl+N 새 채팅  Ctrl+Q 종료";
  const hintWidth = displayWidth(hints);
  const statusWidth = Math.max(1, width - hintWidth - 1);
  const fittedStatus = fitText(status, statusWidth);
  return `${color}${fittedStatus}${RESET} ${COLORS.dim}${hints}${RESET}`;
}

function channelLabel(channel) {
  if (channel.title) return channel.title;
  const firstUseful = channel.messages.find(
    (message) => message.role === "user",
  );
  return firstUseful?.content || "새 채팅";
}

/** Full-screen, dependency-free terminal chat UI. */
export class ChatTui extends EventEmitter {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    super();
    this.input = input;
    this.output = output;
    this.channels = [];
    this.activeIndex = 0;
    this.focus = "composer";
    this.inputText = "";
    this.cursor = 0;
    this.scrollOffset = 0;
    this.notice = "준비됨";
    this.noticeKind = "info";
    this.busyChannels = new Set();
    this.closed = false;
    this.onKeypress = this.onKeypress.bind(this);
    this.onResize = this.render.bind(this);
  }

  start(channels) {
    this.channels = channels;
    readline.emitKeypressEvents(this.input);
    if (this.input.isTTY) this.input.setRawMode(true);
    this.input.resume();
    this.input.on("keypress", this.onKeypress);
    this.output.on?.("resize", this.onResize);
    this.output.write(`${ESC}?1049h${ESC}?25l${ESC}2J`);
    this.render();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.input.off("keypress", this.onKeypress);
    this.output.off?.("resize", this.onResize);
    if (this.input.isTTY) this.input.setRawMode(false);
    this.output.write(`${ESC}?25h${ESC}?1049l`);
  }

  get activeChannel() {
    return this.channels[this.activeIndex];
  }

  setChannels(channels, activeId = this.activeChannel?.id) {
    this.channels = channels;
    const nextIndex = channels.findIndex((channel) => channel.id === activeId);
    this.activeIndex =
      nextIndex >= 0
        ? nextIndex
        : Math.min(this.activeIndex, channels.length - 1);
    this.render();
  }

  addChannel(channel) {
    this.channels.unshift(channel);
    this.activeIndex = 0;
    this.scrollOffset = 0;
    this.focus = "composer";
    this.notice = "새 채팅을 만들었습니다";
    this.render();
  }

  addMessage(channelId, message) {
    const channel = this.channels.find((item) => item.id === channelId);
    if (!channel) return;
    channel.messages.push(message);
    channel.messageCount = (channel.messageCount || 0) + 1;
    if (message.role === "user" && channel.title === "새 채팅") {
      channel.title = sanitizeText(message.content)
        .replace(/\s+/g, " ")
        .slice(0, 32);
    }
    if (this.activeChannel?.id === channelId) this.scrollOffset = 0;
    this.render();
  }

  setNotice(message, kind = "info") {
    this.notice = sanitizeText(message);
    this.noticeKind = kind;
    this.render();
  }

  setBusy(channelId, busy) {
    if (busy) this.busyChannels.add(channelId);
    else this.busyChannels.delete(channelId);
    this.render();
  }

  onKeypress(text, key = {}) {
    if (key.ctrl && (key.name === "c" || key.name === "q")) {
      this.close();
      this.emit("quit");
      return;
    }
    if (key.ctrl && key.name === "n") {
      this.emit("new-channel");
      return;
    }
    if (key.name === "tab") {
      this.focus = this.focus === "channels" ? "composer" : "channels";
      this.render();
      return;
    }
    if (key.name === "pageup" || (key.ctrl && key.name === "u")) {
      this.scrollOffset += 5;
      this.render();
      return;
    }
    if (key.name === "pagedown" || (key.ctrl && key.name === "d")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 5);
      this.render();
      return;
    }
    if (this.focus === "channels") return this.handleChannelKey(key);
    this.handleComposerKey(text, key);
  }

  handleChannelKey(key) {
    if (key.name === "up") this.activeIndex = Math.max(0, this.activeIndex - 1);
    else if (key.name === "down")
      this.activeIndex = Math.min(
        this.channels.length - 1,
        this.activeIndex + 1,
      );
    else if (key.name === "return" || key.name === "right") {
      this.focus = "composer";
      this.scrollOffset = 0;
    } else return;
    this.render();
  }

  handleComposerKey(text, key) {
    if (key.name === "return") {
      if (key.shift || key.meta) {
        this.inputText =
          this.inputText.slice(0, this.cursor) +
          "\n" +
          this.inputText.slice(this.cursor);
        this.cursor += 1;
      } else {
        const content = this.inputText.trim();
        if (content && this.activeChannel) {
          this.inputText = "";
          this.cursor = 0;
          this.emit("send", { channelId: this.activeChannel.id, content });
        }
      }
    } else if (key.name === "backspace") {
      if (this.cursor > 0) {
        const before = [...this.inputText.slice(0, this.cursor)];
        before.pop();
        const next = before.join("") + this.inputText.slice(this.cursor);
        this.cursor = before.join("").length;
        this.inputText = next;
      }
    } else if (key.name === "delete") {
      const after = [...this.inputText.slice(this.cursor)];
      after.shift();
      this.inputText = this.inputText.slice(0, this.cursor) + after.join("");
    } else if (key.name === "left") {
      const previous = [...this.inputText.slice(0, this.cursor)].at(-1);
      this.cursor = Math.max(0, this.cursor - (previous?.length || 0));
    } else if (key.name === "right") {
      const next = [...this.inputText.slice(this.cursor)][0];
      this.cursor = Math.min(
        this.inputText.length,
        this.cursor + (next?.length || 0),
      );
    } else if (key.name === "home") this.cursor = 0;
    else if (key.name === "end") this.cursor = this.inputText.length;
    else if (!key.ctrl && !key.meta && text && !/^\u001b/.test(text)) {
      this.inputText =
        this.inputText.slice(0, this.cursor) +
        text +
        this.inputText.slice(this.cursor);
      this.cursor += text.length;
    } else return;
    this.render();
  }

  render() {
    if (this.closed) return;
    const width = this.output.columns || 100;
    const height = this.output.rows || 30;
    if (width < 44 || height < 12) {
      const warning = fitText(
        `터미널 크기를 늘려주세요 (현재 ${width}×${height}, 최소 44×12)`,
        Math.max(1, width),
      );
      this.output.write(
        `${ESC}?25l${ESC}H${COLORS.yellow}${warning}${RESET}${ESC}J`,
      );
      return;
    }
    const sidebarWidth =
      width >= 76 ? Math.min(28, Math.floor(width * 0.27)) : 0;
    const mainWidth = width - sidebarWidth - (sidebarWidth ? 1 : 0);
    const composerHeight = Math.min(
      6,
      Math.max(3, this.inputText.split("\n").length + 2),
    );
    const bodyHeight = height - composerHeight - 4;
    const lines = [];

    lines.push(
      `${COLORS.purple}◆ AiMate${RESET}  ${COLORS.dim}Terminal conversations${RESET}${" ".repeat(Math.max(0, width - 33))}`,
    );
    lines.push(border("─", "─", "─", width));

    const messageLines = this.renderMessages(mainWidth - 4, bodyHeight);
    const channelLines = this.renderChannels(sidebarWidth, bodyHeight);
    for (let row = 0; row < bodyHeight; row += 1) {
      const sidebar = sidebarWidth
        ? `${channelLines[row]}${COLORS.border}│${RESET}`
        : "";
      lines.push(
        `${sidebar}  ${fitText(messageLines[row] || "", mainWidth - 4)}  `,
      );
    }

    if (sidebarWidth)
      lines.push(
        `${border("└", "─", "┘", sidebarWidth)}${COLORS.border}┴${RESET}${border("─", "─", "─", mainWidth - 1)}`,
      );
    else lines.push(border("─", "─", "─", width));

    const inputWidth = width - 4;
    const wrappedInput = wrapText(
      this.inputText || `${COLORS.dim}메시지를 입력하세요…${RESET}`,
      inputWidth,
    );
    lines.push(
      `${this.focus === "composer" ? COLORS.cyan : COLORS.border}╭${"─".repeat(width - 2)}╮${RESET}`,
    );
    for (let row = 0; row < composerHeight - 2; row += 1) {
      const raw = wrappedInput[row] || "";
      const padding = Math.max(
        0,
        inputWidth - displayWidth(raw.replace(/\u001b\[[0-9;]*m/g, "")),
      );
      lines.push(
        `${this.focus === "composer" ? COLORS.cyan : COLORS.border}│${RESET} ${raw}${" ".repeat(padding)} ${this.focus === "composer" ? COLORS.cyan : COLORS.border}│${RESET}`,
      );
    }
    lines.push(
      `${this.focus === "composer" ? COLORS.cyan : COLORS.border}╰${"─".repeat(width - 2)}╯${RESET}`,
    );
    const activeBusy =
      this.activeChannel && this.busyChannels.has(this.activeChannel.id);
    lines.push(
      renderStatusLine({
        status: activeBusy ? "● 답변을 준비하고 있어요" : `● ${this.notice}`,
        color: activeBusy
          ? COLORS.yellow
          : this.noticeKind === "error"
            ? COLORS.red
            : COLORS.green,
        width,
      }),
    );

    this.output.write(
      `${ESC}?25l${ESC}H${lines.slice(0, height).join("\n")}${ESC}J`,
    );
    if (this.focus === "composer") {
      const beforeCursor = this.inputText.slice(0, this.cursor).split("\n");
      const cursorRow = Math.min(composerHeight - 3, beforeCursor.length - 1);
      const cursorCol = Math.min(inputWidth, displayWidth(beforeCursor.at(-1)));
      const screenRow = height - composerHeight;
      this.output.write(
        `${ESC}${screenRow + cursorRow + 1};${cursorCol + 3}H${ESC}?25h`,
      );
    }
  }

  renderChannels(width, height) {
    if (!width) return [];
    const lines = [
      ` ${this.focus === "channels" ? COLORS.cyan : COLORS.dim}대화 목록${RESET}`,
    ];
    for (
      let index = 0;
      index < Math.min(this.channels.length, height - 2);
      index += 1
    ) {
      const channel = this.channels[index];
      const selected = index === this.activeIndex;
      const busy = this.busyChannels.has(channel.id)
        ? "●"
        : selected
          ? "›"
          : " ";
      const count = channel.messageCount || channel.messages.length;
      const label = `${busy} ${channelLabel(channel)}`;
      lines.push(
        `${selected ? COLORS.selected : ""}${fitText(label, width - 1)}${RESET}`,
      );
      if (selected && count)
        lines.push(
          `${COLORS.dim}   ${count}개 메시지${RESET}${" ".repeat(Math.max(0, width - 13))}`,
        );
    }
    while (lines.length < height) lines.push(" ".repeat(width));
    return lines.slice(0, height);
  }

  renderMessages(width, height) {
    const channel = this.activeChannel;
    if (!channel || !channel.messages.length) {
      const title = "새로운 대화를 시작해 보세요";
      const help = "메시지를 입력하고 Enter를 누르면 됩니다.";
      const top = Math.max(0, Math.floor(height / 2) - 2);
      return [
        ...Array(top).fill(""),
        `${COLORS.purple}${title}${RESET}`,
        `${COLORS.dim}${help}${RESET}`,
      ];
    }
    const all = [];
    let previousRole = null;
    for (const message of channel.messages) {
      const isUser = message.role === "user";
      if (message.role !== previousRole) {
        if (all.length) all.push("");
        const author = isUser
          ? `${COLORS.cyan}나${RESET}`
          : `${COLORS.purple}AiMate${RESET}`;
        const timestamp = message.createdAt
          ? new Date(message.createdAt).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        all.push(`${author} ${COLORS.dim}${timestamp}${RESET}`);
        previousRole = message.role;
      }
      for (const line of wrapText(message.content, width - 2))
        all.push(`  ${line}`);
    }
    all.push("");
    const end = Math.max(0, all.length - this.scrollOffset);
    const start = Math.max(0, end - height);
    return [
      ...Array(Math.max(0, height - (end - start))).fill(""),
      ...all.slice(start, end),
    ];
  }
}
