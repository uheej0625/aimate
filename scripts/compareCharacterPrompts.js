import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { parseArgs } from "util";
import { generateText, tool } from "ai";
import { createConfigManager, validateAiConfig } from "../src/config/index.js";
import { loadEnv } from "../src/config/env.js";
import { CharacterContextBuilder } from "../src/character/CharacterContextBuilder.js";
import { PromptComposer } from "../src/chat/context/PromptComposer.js";
import { SequenceBuilder } from "../src/chat/context/SequenceBuilder.js";
import { HistoryService } from "../src/messages/HistoryService.js";
import { ChatGenerator } from "../src/ai/ChatGenerator.js";
import { AIResponseParser } from "../src/chat/response/AIResponseParser.js";
import { hasEnabledNativeTools } from "../src/ai/dialects.js";
import statusTool from "../src/tools/definitions/setDiscordStatus.js";
import photoTool from "../src/tools/definitions/generatePhoto.js";
import { cases, referenceDate } from "./characterPromptCases.js";

const defaultPromptDir = "content/prompts/default-v2/chat";
const defaultCharacterDir = "content/characters/haneul-v2";

async function newDirectory(directory) {
  await fs.mkdir(path.dirname(path.resolve(directory)), { recursive: true });
  // Never merge with an earlier run or overwrite the only baseline.
  await fs.mkdir(directory);
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
}

export async function snapshot({
  out,
  promptDir = defaultPromptDir,
  characterDir = defaultCharacterDir,
}) {
  await fs.access(path.join(promptDir, "sequence.js"));
  await fs.access(path.join(characterDir, "identity.md"));
  await newDirectory(out);
  await fs.cp(promptDir, path.join(out, "prompts/default/chat"), {
    recursive: true,
  });
  await fs.cp(characterDir, path.join(out, "character"), { recursive: true });
  await writeJson(path.join(out, "snapshot.json"), {
    promptName: "default",
    character: path.basename(path.resolve(characterDir)),
    sourceCharacterDir: characterDir,
    createdAt: new Date().toISOString(),
  });
}

export function checkContract(text = "") {
  const violations = [];
  const match = text
    .trim()
    .match(
      /^# response\r?\n\s*\r?\n?## messages\r?\n(?:[ \t]*\r?\n)*([^\r\n]+)$/,
    );
  if (!match)
    return [
      "Expected # response, ## messages and a single nonempty body line.",
    ];
  const body = match[1];
  if (body.split("[BREAK]").some((chunk) => !chunk.trim())) {
    violations.push("Empty message around [BREAK].");
  }
  if (/\[\s*break\s*\]/i.test(body.replaceAll("[BREAK]", ""))) {
    violations.push("Invalid [BREAK] separator spelling.");
  }
  if (
    /`|\*\*|__|~~|\[[^\]]+\]\(|(?:^|\s)#{1,6}\s|(?:^|\s)[*+>-]\s|(?:^|\s)\d+[.)]\s|\*[^*]+\*|_[^_]+_/.test(
      body,
    )
  ) {
    violations.push("Markdown formatting inside the message body.");
  }
  return violations;
}

export function usageSummary(usage) {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    cacheReadTokens:
      usage?.inputTokenDetails?.cacheReadTokens ??
      usage?.cachedInputTokens ??
      null,
  };
}

export function createEvaluationTools(testCase, calls) {
  if (!testCase.toolMode) return {};
  return Object.fromEntries(
    [statusTool, photoTool].map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: async (input) => {
          const output =
            definition.name === photoTool.name
              ? {
                  error:
                    "이미지 생성 서비스가 일시적으로 실패했습니다. 이미지가 생성되지 않았습니다.",
                }
              : {
                  success: true,
                  message: input.message,
                  type: input.type ?? "PLAYING",
                };
          calls.push({ toolName: definition.name, input, output });
          return output;
        },
      }),
    ]),
  );
}

// Persist selected model fields only, never SDK request/response objects or headers.
function stepSummary(step) {
  return {
    text: step.text ?? "",
    finishReason: step.finishReason,
    usage: usageSummary(step.usage),
    toolCalls: (step.toolCalls ?? []).map(({ toolName, input }) => ({
      toolName,
      input,
    })),
    toolResults: (step.toolResults ?? []).map(({ toolName, output }) => ({
      toolName,
      output,
    })),
  };
}

function checkRawResult(rawText, steps, testCase) {
  const violations = steps.flatMap((step, index) => {
    if (step.toolCalls.length) {
      return step.text.trim()
        ? [`Step ${index + 1}: text mixed with a tool call.`]
        : [];
    }
    return step.text.trim()
      ? checkContract(step.text).map((issue) => `Step ${index + 1}: ${issue}`)
      : [];
  });
  if (rawText.trim() || !steps.at(-1)?.toolCalls.length) {
    violations.push(...checkContract(rawText));
  }
  const nativeCalls = steps.flatMap((step) => step.toolCalls);
  if (
    testCase.expectedTool &&
    !nativeCalls.some((call) => call.toolName === testCase.expectedTool)
  ) {
    violations.push(`Missing native tool call: ${testCase.expectedTool}.`);
  }
  return violations;
}

export async function evaluate({
  prepared,
  testCase,
  configManager,
  generateTextFn = generateText,
  createLanguageModelFn,
}) {
  const toolExecutions = [];
  const appTools = createEvaluationTools(testCase, toolExecutions);
  let captured = null;
  const completedSteps = [];
  const generator = new ChatGenerator({
    configManager,
    createLanguageModelFn,
    toolRegistry: { createToolSet: () => appTools },
    generateTextFn: async (request) => {
      const result = await generateTextFn({
        ...request,
        onStepFinish: (step) => {
          completedSteps.push(stepSummary(step));
        },
      });
      captured = {
        rawText: result.text ?? "",
        steps: result.steps?.length
          ? result.steps.map(stepSummary)
          : completedSteps,
        usage: usageSummary(result.usage),
        totalUsage: usageSummary(result.totalUsage),
      };
      // Validate before returning control to the production parser/tool recovery.
      captured.violations = checkRawResult(
        captured.rawText,
        captured.steps,
        testCase,
      );
      return result;
    },
  });
  try {
    const result = await generator.generate(
      prepared.context,
      prepared.systemInstruction,
      "discord",
    );
    const violations = captured.violations;
    if (
      result.apiResponses.some((response) => response.recoveredTextToolCall)
    ) {
      violations.push(
        "Production text-tool recovery was used; the original response violated the contract.",
      );
    }
    return {
      status: "completed",
      ...captured,
      rawParsedMessages: new AIResponseParser().parse(captured.rawText)
        .messages,
      messages: result.messages,
      messageCount: result.messages.length,
      toolExecutions,
      violations: [...new Set(violations)],
      review: "미검토: 사례별 기대 기준과 원문을 사람이 확인해야 합니다.",
    };
  } catch (error) {
    return {
      status: "api-error",
      error: {
        name: error.name,
        message: error.message,
        statusCode: error.statusCode ?? null,
      },
      steps: completedSteps,
      toolExecutions,
      violations: [],
    };
  }
}

function createSanitizer(config) {
  const values = [];
  const secretKey =
    /secret|password|credential|authorization|headers|api.?key|private.?key|client.?email/i;
  function collect(value, sensitive = false) {
    if (typeof value === "string" && sensitive && value) values.push(value);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value))
        collect(child, sensitive || secretKey.test(key));
    }
  }
  collect(config);
  return function sanitize(value) {
    if (typeof value === "string") {
      for (const secret of values)
        value = value.replaceAll(secret, "[REDACTED]");
      return value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
    }
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          secretKey.test(key) ? "[REDACTED]" : sanitize(child),
        ]),
      );
    }
    return value;
  };
}

function reportMarkdown(report) {
  const lines = [
    `# ${report.character} 프롬프트 비교`,
    "",
    `모델: ${report.settings.chat.provider} / ${report.settings.chat.model}`,
    `기준 시각: ${referenceDate}. 각 사례의 입력은 양쪽에 동일하며 생성 결과를 다음 사례에 전달하지 않습니다.`,
    "도구는 모의 실행입니다. 캐시 미제공은 미측정이며, 캐시 개선이나 캐릭터성 합격을 자동 판정하지 않습니다.",
    "",
  ];
  for (const item of report.results) {
    lines.push(
      `## ${item.id} / ${item.title}`,
      "",
      `기대 기준: ${item.expected}`,
      "",
    );
    for (const variant of ["before", "after"]) {
      const result = item[variant];
      if (!result) continue;
      lines.push(`### ${variant}`, "", `상태: ${result.status}`, "");
      if (result.status === "completed") {
        const usage = result.totalUsage;
        lines.push(
          `메시지 수: ${result.messageCount}; 입력 토큰: ${usage.inputTokens ?? "미측정"}; 출력 토큰: ${usage.outputTokens ?? "미측정"}; 캐시 읽기: ${usage.cacheReadTokens ?? "미측정"}`,
          `자동 검사: ${result.violations.length ? result.violations.join(" / ") : "위반 없음"}`,
          `사람 검토: ${result.review}`,
          "",
          "원문:",
          "",
          ...result.rawText.split("\n").map((line) => `> ${line}`),
          "",
          "도구 실행: " + JSON.stringify(result.toolExecutions),
          "",
        );
      } else if (result.error) lines.push(result.error.message, "");
    }
  }
  return lines.join("\n") + "\n";
}

export async function compare({
  baseline,
  out,
  dryRun = false,
  caseId,
  configManager,
  promptDir = defaultPromptDir,
  generateTextFn,
  createLanguageModelFn,
}) {
  const selectedCases = caseId
    ? cases.filter((item) => item.id === caseId)
    : cases;
  if (!selectedCases.length) throw new Error(`Unknown case: ${caseId}`);
  const snapshotInfo = JSON.parse(
    await fs.readFile(path.join(baseline, "snapshot.json"), "utf8"),
  );
  const baselinePromptName = snapshotInfo.promptName ?? "ultimate";
  const config = structuredClone(configManager.getAll());
  if (hasEnabledNativeTools(config.ai.chat)) {
    throw new Error(
      "Comparison requires nativeTools disabled; only simulated application tools are allowed.",
    );
  }
  // Each comparison uses a frozen copy of the current config without modifying it on disk.
  const frozenManager = {
    getAll: () => structuredClone(config),
    get: (key) => key.split(".").reduce((value, part) => value?.[part], config),
  };
  if (!dryRun) await validateAiConfig(frozenManager, ["chat"]);
  await newDirectory(out);
  await fs.cp(
    path.join(baseline, "prompts", baselinePromptName, "chat"),
    path.join(out, "before/prompts/default/chat"),
    { recursive: true },
  );
  await fs.cp(promptDir, path.join(out, "after/prompts/default/chat"), {
    recursive: true,
  });
  await fs.cp(path.join(baseline, "character"), path.join(out, "character"), {
    recursive: true,
  });
  const sanitize = createSanitizer(config);
  const report = {
    character: snapshotInfo.character,
    referenceDate,
    dryRun,
    settings: sanitize({
      chat: config.ai.chat,
      app: { language: config.app.language, timezone: config.app.timezone },
      maxSteps: config.tools?.maxSteps,
    }),
    results: [],
  };
  const save = async () => {
    const safeReport = sanitize(report);
    await writeJson(path.join(out, "results.json"), safeReport);
    await fs.writeFile(path.join(out, "report.md"), reportMarkdown(safeReport));
  };
  await save();
  const previousPlatform = process.env.PLATFORM;
  process.env.PLATFORM = "discord";
  try {
    for (const testCase of selectedCases) {
      const history = new HistoryService(
        {
          snapshot: async () => ({
            events: structuredClone(testCase.events),
            fromExclusive: 0,
          }),
        },
        { findGenerationInputsByIds: async () => new Map() },
      );
      const data = await history.fetchHistoryData("evaluation", "bot");
      const item = {
        id: testCase.id,
        title: testCase.title,
        expected: testCase.expected,
        events: testCase.events,
      };
      report.results.push(item);
      for (const variant of ["before", "after"]) {
        const composer = new PromptComposer(
          frozenManager,
          new CharacterContextBuilder({
            identityPath: path.join(out, "character/identity.md"),
            variablesPath: path.join(out, "character/variables.json"),
          }),
        );
        const builder = new SequenceBuilder(composer, {
          promptsRoot: path.join(out, variant, "prompts"),
        });
        const prepared = await builder.build(
          await builder.loadSequence("default"),
          {
            ...data,
            botId: "bot",
            promptName: "default",
            referenceDate: new Date(referenceDate),
          },
        );
        const appTools = createEvaluationTools(testCase, []);
        const input = {
          ...prepared,
          tools: Object.entries(appTools).map(([name, definition]) => ({
            name,
            description: definition.description,
            inputSchema: definition.inputSchema.jsonSchema,
          })),
        };
        await writeJson(
          path.join(out, `${testCase.id}-${variant}-input.json`),
          sanitize(input),
        );
        item[variant] = dryRun
          ? { status: "dry-run" }
          : await evaluate({
              prepared,
              testCase,
              configManager: frozenManager,
              generateTextFn,
              createLanguageModelFn,
            });
        await save();
        console.log(`${testCase.id} / ${variant}: ${item[variant].status}`);
      }
    }
  } finally {
    if (previousPlatform === undefined) delete process.env.PLATFORM;
    else process.env.PLATFORM = previousPlatform;
  }
  return sanitize(report);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      baseline: { type: "string" },
      case: { type: "string" },
      "dry-run": { type: "boolean" },
      "prompt-dir": { type: "string" },
      "character-dir": { type: "string" },
    },
  });
  if (
    positionals.length !== 1 ||
    !values.out ||
    !["snapshot", "compare"].includes(positionals[0])
  ) {
    throw new Error(
      "Usage: snapshot --out <new-folder> [--prompt-dir <path>] [--character-dir <path>] | compare --baseline <snapshot> --out <new-folder> [--prompt-dir <path>] [--dry-run] [--case <ID>]",
    );
  }
  if (positionals[0] === "snapshot") {
    await snapshot({
      out: values.out,
      promptDir: values["prompt-dir"],
      characterDir: values["character-dir"],
    });
    console.log(`Snapshot saved: ${values.out}`);
    return;
  }
  if (!values.baseline) throw new Error("compare requires --baseline.");
  loadEnv();
  const configManager = createConfigManager({ watch: false });
  const report = await compare({
    baseline: values.baseline,
    out: values.out,
    caseId: values.case,
    dryRun: values["dry-run"],
    configManager,
    promptDir: values["prompt-dir"],
  });
  if (
    report.results.some((item) =>
      [item.before, item.after].some(
        (result) => result.status === "api-error" || result.violations?.length,
      ),
    )
  ) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    // Configuration errors contain field names only; avoid dumping provider error objects.
    console.error(error.message);
    process.exitCode = 1;
  });
}
