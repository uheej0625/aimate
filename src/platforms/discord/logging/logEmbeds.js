import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
} from "discord.js";

const STATUS = {
  PENDING: { icon: "◌", label: "대기 중", color: 0x94a3b8 },
  PROCESSING: { icon: "◈", label: "생성 중", color: 0x818cf8 },
  GENERATED: { icon: "↗", label: "전송 중", color: 0x38bdf8 },
  COMPLETED: { icon: "✓", label: "완료", color: 0x34d399 },
  CANCELLED: { icon: "⊘", label: "취소됨", color: 0x94a3b8 },
  FAILED: { icon: "!", label: "실패", color: 0xfb7185 },
};

function text(value, limit = 1024) {
  const escaped = escapeMarkdown(String(value ?? "").trim());
  return escaped
    ? escaped.length > limit
      ? `${escaped.slice(0, limit - 1)}…`
      : escaped
    : "—";
}

function json(value, fallback) {
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function field(name, value, inline = false) {
  return { name, value: String(value), inline };
}

function requestText(input) {
  const snapshot = input.eventSnapshot;
  if (!snapshot) {
    return Array.isArray(input.messages)
      ? input.messages.map((message) => message.content).join("\n")
      : null;
  }
  const inputIds = new Set(snapshot.inputEventIds);
  const original = (value) =>
    value == null ? "(내용 미상)" : JSON.stringify(value);
  return snapshot.events
    .filter((event) => inputIds.has(event.id))
    .sort(
      (a, b) => new Date(a.observedAt) - new Date(b.observedAt) || a.id - b.id,
    )
    .map((event) => {
      const number = `#${event.channelMessageNo ?? "?"}`;
      const content = original(event.snapshotContent);
      if (event.kind === "EDIT")
        return `${number} [수정] ${original(event.previousContent)} → ${content}`;
      if (event.kind === "DELETE") return `${number} [삭제] ${content}`;
      return `${number} [메시지] ${content}`;
    })
    .join("\n");
}

function generationTexts(record) {
  if (record.type === "CHAT") {
    const input = json(record.input, {});
    const stored = json(record.apiResponse, {});
    const response = Array.isArray(stored) ? stored.at(-1) : stored;
    const messages = response?.response?.messages;
    const previousCount =
      response?.steps?.at(-2)?.response?.messages?.length ?? 0;
    const assistant = messages
      ?.slice(previousCount)
      .findLast((message) => message.role === "assistant");
    return {
      request: requestText(input),
      response: assistant
        ? typeof assistant.content === "string"
          ? assistant.content
          : assistant.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")
        : messages
          ? ""
          : null,
    };
  }
  return { request: record.input, response: record.output };
}

export function apiTexts(record) {
  const stored = json(record.apiResponse, null);
  const responses = Array.isArray(stored) ? stored : [stored];
  const requests = responses.flatMap((response, call) => {
    const steps = (response?.steps ?? [])
      .map((step, index) => ({
        step: step.stepNumber ?? index,
        request: step.request,
      }))
      .filter((step) => step.request != null);
    const entries = steps.length
      ? steps
      : response?.request != null
        ? [{ request: response.request }]
        : [];
    return entries.map((entry) => ({ call: call + 1, ...entry }));
  });
  return {
    request:
      record.apiRequest != null || requests.length
        ? JSON.stringify(
            {
              apiRequest: json(record.apiRequest, record.apiRequest),
              requests,
            },
            null,
            2,
          )
        : null,
    response:
      record.apiResponse != null
        ? JSON.stringify(json(record.apiResponse, record.apiResponse), null, 2)
        : null,
  };
}

export function buildLogButtons(record) {
  const originals = apiTexts(record);
  return [
    new ActionRowBuilder().addComponents(
      ...[
        ["request", "API 요청 전문"],
        ["response", "API 응답 전문"],
      ].map(([name, label]) =>
        new ButtonBuilder()
          .setCustomId(`aimate-log:${name}:${record.id}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(originals[name] == null),
      ),
    ),
  ];
}

function pipeline(record) {
  const input = json(record.input, {});
  const snapshot = input.eventSnapshot;
  const ids = new Set(snapshot?.inputEventIds);
  const observed = (snapshot?.events ?? [])
    .filter((event) => ids.has(event.id))
    .map((event) => new Date(event.observedAt).getTime())
    .filter(Number.isFinite);
  const started = new Date(record.createdAt).getTime();
  const waiting = observed.length ? Math.min(...observed, started) : started;
  const timing = json(record.metadata, {})?.timings ?? {};
  const terminal = ["COMPLETED", "CANCELLED", "FAILED"].includes(record.status);
  const ended =
    timing.completedAt ??
    (terminal && !record.discardedAt ? record.updatedAt : null);
  const generated = timing.generatedAt;
  const elapsed = (from, to) =>
    from != null && to != null
      ? `${Math.max(0, (new Date(to) - new Date(from)) / 1000).toFixed(1)}s`
      : null;
  const stages = [
    [
      "대기",
      record.status === "PENDING" ? null : elapsed(waiting, started),
      record.status === "PENDING",
    ],
    [
      "생성",
      elapsed(
        started,
        generated ??
          (["FAILED", "CANCELLED"].includes(record.status) ? ended : null),
      ),
      record.status === "PROCESSING",
    ],
    ["전송", elapsed(generated, ended), record.status === "GENERATED"],
  ];
  return {
    started: waiting,
    total: elapsed(waiting, ended),
    description: stages
      .map(
        ([name, duration, active]) =>
          `${duration ? "▰" : "▱"} ${name} ${duration ?? (active ? "진행 중" : "—")}`,
      )
      .join("  ›  "),
  };
}

function technicalFields(record) {
  const stored = json(record.apiResponse, []);
  const responses = Array.isArray(stored) ? stored : [stored];
  const requests = json(record.apiRequest, []);
  const models = new Set();
  const providers = new Set();
  const tools = [];
  const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const known = new Set();
  for (const response of responses) {
    if (!response) continue;
    if (response.response?.modelId) models.add(response.response.modelId);
    for (const step of response.steps ?? []) {
      const model = step.model?.modelId ?? step.response?.modelId;
      if (model) models.add(model);
      if (step.model?.provider) providers.add(step.model.provider);
    }
    const stepCalls = (response.steps ?? []).flatMap(
      (step) => step.toolCalls ?? [],
    );
    const messageCalls = (response.response?.messages ?? []).flatMap(
      (message) =>
        Array.isArray(message.content)
          ? message.content.filter((part) => part.type === "tool-call")
          : [],
    );
    const calls = stepCalls.length
      ? stepCalls
      : response.toolCalls?.length
        ? response.toolCalls
        : messageCalls;
    for (const call of [...calls, response.recoveredTextToolCall]) {
      if (call?.toolName)
        tools.push(
          `${call.toolName}(${call.input === undefined ? "" : JSON.stringify(call.input)})`,
        );
    }
    const usages =
      response.totalUsage || response.usage
        ? [response.totalUsage ?? response.usage]
        : (response.steps ?? []).map((step) => step.usage);
    for (const usage of usages) {
      const values = { ...usage };
      if (
        !Number.isFinite(values.totalTokens) &&
        Number.isFinite(values.inputTokens) &&
        Number.isFinite(values.outputTokens)
      )
        values.totalTokens = values.inputTokens + values.outputTokens;
      for (const key of Object.keys(totals)) {
        if (Number.isFinite(values[key])) {
          totals[key] += values[key];
          known.add(key);
        }
      }
    }
  }
  const configuredModels = new Set();
  for (const request of Array.isArray(requests) ? requests : [requests]) {
    if (request?.provider) providers.add(request.provider);
    if (request?.model) configuredModels.add(request.model);
  }
  if (!models.size) for (const model of configuredModels) models.add(model);
  return [
    ...(providers.size
      ? [field("Provider", text([...providers].join(" · "), 400))]
      : []),
    ...(models.size ? [field("모델", text([...models].join(" · "), 400))] : []),
    ...(known.size
      ? [
          field(
            "토큰 · usage",
            [
              ["inputTokens", "입력"],
              ["outputTokens", "출력"],
              ["totalTokens", "합계"],
            ]
              .filter(([key]) => known.has(key))
              .map(([key, name]) => `${name} ${totals[key]}`)
              .join(" · "),
          ),
        ]
      : []),
    ...(tools.length ? [field("도구 호출", text(tools.join("\n")))] : []),
  ];
}

function originalField(name, value, placeholder) {
  if (value == null) return field(name, placeholder);
  if (value === "") return field(name, "(빈 원문)");
  const escaped = escapeMarkdown(value);
  return field(
    name,
    escaped.length > 1024
      ? `${escaped.slice(0, 980)}…\n↳ 아래 전문 버튼이나 첨부 파일로 확인하세요.`
      : escaped,
  );
}

export function buildLogFiles(record) {
  return Object.entries(generationTexts(record))
    .filter(
      ([, value]) =>
        typeof value === "string" && escapeMarkdown(value).length > 1024,
    )
    .map(([name, value]) => ({
      attachment: Buffer.from(value, "utf8"),
      name: `generation-${record.id}-${name}.txt`,
    }));
}

function base(record, channel, color, title) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: "AiMate  /  GENERATION" })
    .setTitle(title)
    .addFields(field("대화 채널", `<#${channel.platformId}>`, true))
    .setFooter({
      text: `Generation${String(record.id).startsWith("waiting:") ? " · 대기" : ` #${record.id}`}  ·  AiMate Logs`,
    })
    .setTimestamp(new Date(record.updatedAt ?? record.createdAt));
}

export function buildLogEmbed(record, channel) {
  const state = STATUS[record.status] ?? STATUS.PENDING;
  const embed = base(
    record,
    channel,
    state.color,
    `${state.icon}  ${state.label}  ·  ${record.type}`,
  );
  const timing = pipeline(record);
  embed
    .setDescription(timing.description)
    .addFields(
      field("상태", `\`${record.status}\``, true),
      field("캐릭터", text(record.characterId, 100), true),
      field("프롬프트", text(record.prompt, 200), true),
      field("시작", `<t:${Math.floor(timing.started / 1000)}:T>`, true),
    );
  if (timing.total) embed.addFields(field("소요 시간", timing.total, true));
  const technical = technicalFields(record);
  if (technical.length) embed.addFields(...technical);
  const originals = generationTexts(record);
  const waiting = ["PENDING", "PROCESSING"].includes(record.status);
  embed.addFields(
    originalField(
      "요청",
      originals.request,
      waiting ? "입력 준비 중" : "요청 원문 없음",
    ),
    originalField(
      "응답",
      originals.response,
      waiting ? "응답 대기 중" : "응답 원문 없음",
    ),
  );
  if (record.type === "CHAT") {
    if (record.status === "COMPLETED" && !record.sentAt) {
      embed.addFields(field("전달", "응답 없이 턴을 마쳤어요."));
    }
  }
  if (record.discardedAt)
    embed.addFields(field("재생성", "이 결과는 재생성으로 폐기되었어요."));
  return embed;
}
