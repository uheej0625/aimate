import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { randomUUID } from "node:crypto";

const labels = {
  naturalness: "자연스러움",
  character: "캐릭터",
  context: "맥락",
  empathy: "공감",
  repetition: "반복·질문 과다",
  message_split: "메시지 분할",
  tool_use: "도구 활용",
  error_response: "오류 뒤 대응",
  output_contract: "출력 계약",
};

export function initialState(runId, settings = {}) {
  return {
    runId,
    settings,
    createdAt: new Date().toISOString(),
    status: "running",
    stopReason: null,
    cursor: 0,
    pending: null,
    findingCounts: {},
    representatives: [],
    channels: [
      "일상과 친밀감",
      "고민과 감정 변화",
      "관심사와 함께하는 활동",
    ].map((theme, index) => ({
      id: `review-${index + 1}`,
      userId: `review-user-${index + 1}`,
      userName: ["지우", "민서", "도윤"][index],
      theme,
      turnCount: 0,
      evaluatedThrough: 0,
      memorySummary: "",
      history: [],
      recentFindings: [],
    })),
  };
}

/** JSONL is authoritative; bounded snapshots and reports can always be rebuilt. */
export class ReviewStore {
  constructor(directory, redact = (value) => value) {
    this.directory = directory;
    this.redact = redact;
    this.state = null;
    this.file = null;
    this.writes = Promise.resolve();
  }

  async open({ runId, settings, resume = false }) {
    if (!resume) await fs.mkdir(this.directory, { recursive: false });
    const filename = path.join(this.directory, "events.jsonl");
    let needsNewline = false;
    if (resume) {
      let validBytes = 0;
      const lines = createInterface({
        input: createReadStream(filename),
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          // Only an incomplete final append is recoverable.
          const size = (await fs.stat(filename)).size;
          if (validBytes + Buffer.byteLength(line) < size - 1)
            throw new Error("Corrupt review journal.");
          break;
        }
        applyEvent(this, event);
        validBytes += Buffer.byteLength(line) + 1;
      }
      if (!this.state || this.state.runId !== runId)
        throw new Error("Invalid review journal.");
      // Drop a torn final append before writing the next complete record.
      const size = (await fs.stat(filename)).size;
      needsNewline = validBytes === size + 1;
      await fs.truncate(filename, Math.min(validBytes, size));
    }
    this.file = await fs.open(filename, resume ? "a" : "ax");
    if (needsNewline) await this.file.write("\n");
    if (!resume)
      await this.record({
        type: "started",
        state: initialState(runId, settings),
      });
    else await this.record({ type: "resumed", settings });
    return this;
  }

  record(event) {
    this.writes = this.writes
      .catch(() => {})
      .then(() => this.writeEvent(event));
    return this.writes;
  }

  async writeEvent(event) {
    const safe = this.redact({ ...event, at: new Date().toISOString() });
    await this.file.write(JSON.stringify(safe) + "\n");
    await this.file.sync();
    applyEvent(this, safe);
    await this.snapshot();
  }

  async snapshot() {
    await atomicWrite(
      path.join(this.directory, "state.json"),
      JSON.stringify(this.state, null, 2) + "\n",
    );
    await atomicWrite(
      path.join(this.directory, "report.md"),
      renderReport(this.state),
    );
  }

  async close() {
    await this.writes.catch(() => {});
    await this.file?.close();
    this.file = null;
  }
}

function applyEvent(store, event) {
  if (event.type === "started") {
    store.state = event.state;
    return;
  }
  const state = store.state;
  if (!state) throw new Error("Missing review start record.");
  if (event.type === "resumed") {
    state.status = "running";
    state.stopReason = null;
    if (event.settings) state.settings = event.settings;
  }
  if (event.type === "stopped") {
    state.status = "stopped";
    state.stopReason = event.reason;
  }
  if (event.type === "reviewed") {
    const channel = state.channels.find(
      (entry) => entry.id === event.channelId,
    );
    channel.memorySummary = event.review.memorySummary;
    channel.evaluatedThrough = channel.turnCount;
    channel.nextMessage = event.review.nextMessage;
    for (const finding of event.review.findings)
      addFinding(state, channel, finding);
  }
  if (event.type === "prepared") {
    state.pending = { ...event.turn, deliveries: [] };
    state.channels.find(
      (channel) => channel.id === event.turn.channelId,
    ).nextMessage = null;
  }
  if (event.type === "delivered") state.pending?.deliveries.push(event.message);
  if (event.type === "responded") {
    const turn = event.turn;
    const channel = state.channels.find((entry) => entry.id === turn.channelId);
    channel.turnCount = turn.number;
    channel.history.push(turn);
    channel.history = channel.history.slice(-40);
    state.pending = null;
    state.cursor =
      (state.channels.indexOf(channel) + 1) % state.channels.length;
    for (const issue of turn.response.contractIssues ?? [])
      addFinding(state, channel, {
        category: "output_contract",
        severity: "medium",
        turns: [turn.number],
        description: issue,
        suggestion: "점검 대상 프롬프트와 응답 원문 계약을 확인하세요.",
      });
  }
  state.updatedAt = event.at;
}

function addFinding(state, channel, finding) {
  const entry = {
    ...finding,
    channelId: channel.id,
    evidence: finding.turns.map((number) => {
      const turn = channel.history.find((turn) => turn.number === number);
      return turn
        ? {
            number,
            user: turn.userMessage,
            assistant: turn.response.messages.map((message) => message.content),
          }
        : { number };
    }),
  };
  const key = `${finding.category}:${finding.severity}`;
  state.findingCounts[key] = (state.findingCounts[key] ?? 0) + 1;
  channel.recentFindings = [...channel.recentFindings, entry].slice(-20);
  // Keep representative evidence bounded while retaining every finding in JSONL.
  state.representatives.push(entry);
  state.representatives.sort(
    (a, b) =>
      ["high", "medium", "low"].indexOf(a.severity) -
      ["high", "medium", "low"].indexOf(b.severity),
  );
  state.representatives = state.representatives.slice(0, 100);
}

async function atomicWrite(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, value);
  await fs.rename(temporary, filename);
}

function quote(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function renderReport(state) {
  const lines = [
    "# AiMate 대화 품질 점검",
    "",
    `실행: ${state.runId}`,
    `상태: ${state.status}${state.stopReason ? ` (${state.stopReason})` : ""}`,
    "",
    "이미지 AI는 호출하지 않고 고정 PNG로 대체했습니다. 이미지 품질과 도구 구현의 정상 작동 여부는 평가하지 않습니다.",
    "Codex 평가는 자동 관찰이며 실제 사용자 평가를 대신하지 않습니다. 턴별 원문과 전체 발견 사항은 events.jsonl에서 확인하세요.",
    "",
    "## 진행 분량",
    "",
    "| 대화 | 응답 턴 | 평가 완료 턴 |",
    "| --- | ---: | ---: |",
    ...state.channels.map(
      (channel) =>
        `| ${channel.theme} | ${channel.turnCount} | ${channel.evaluatedThrough} |`,
    ),
    "",
    "## 반복되는 문제",
    "",
    ...Object.entries(state.findingCounts).map(([key, count]) => {
      const [category, severity] = key.split(":");
      return `- ${labels[category]} / ${severity}: ${count}건`;
    }),
    "",
    "## 개선 우선순위와 대표 근거",
    "",
  ];
  if (!state.representatives.length)
    lines.push(
      "현재까지 기록된 문제 없음. 미평가 턴은 진행 표에서 확인하세요.",
      "",
    );
  for (const finding of state.representatives) {
    lines.push(
      `### ${finding.severity} · ${labels[finding.category]} · ${finding.channelId} ${finding.turns.join(", ")}턴`,
      "",
      finding.description,
      "",
      `개선안: ${finding.suggestion}`,
      "",
    );
    for (const evidence of finding.evidence) {
      lines.push(`근거 ${evidence.number}턴`, "");
      if (evidence.user !== undefined)
        lines.push(
          quote(`사용자: ${evidence.user}`),
          "",
          quote(`AiMate: ${evidence.assistant.join(" / ")}`),
          "",
        );
      else lines.push("원문은 events.jsonl의 해당 턴을 확인하세요.", "");
    }
  }
  lines.push(
    "## 실행 조건",
    "",
    "```json",
    JSON.stringify(state.settings, null, 2),
    "```",
    "",
  );
  return lines.join("\n");
}
