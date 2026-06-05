import fs from "fs/promises";
import path from "path";
import { loadEnv } from "../src/config/env.js";
import { createConfigManager } from "../src/config/index.js";
import { configureLogger } from "../src/core/logger.js";
import { generateText } from "ai";
import { getAiSettings, getGenerationSettings } from "../src/ai/config.js";
import { toModelMessages } from "../src/ai/chat.js";
import { createLanguageModel } from "../src/ai/models.js";
import {
  BOT_ID,
  PRESSURE_TEST_IDENTITY,
  USER_ID,
  pressureScenarios,
} from "./promptPressureScenarios.js";

loadEnv();

const configManager = createConfigManager({ watch: false });
configureLogger(configManager);

const { PromptComposer } = await import(
  "../src/chat/context/PromptComposer.js"
);
const { SequenceBuilder } = await import(
  "../src/chat/context/SequenceBuilder.js"
);

const PROMPTS_DIR = path.resolve(process.cwd(), "content", "prompts");
const DEFAULT_RUNS = 2;

const EXPECTED_EMOTION_KEYS = [
  "attachment",
  "jealousy",
  "trust",
  "awe",
  "anxiety",
  "possessiveness",
  "self_worth",
];

const EXPECTED_RELATIONSHIP_KEYS = ["affinity", "trust", "affection"];

class StaticCharacterLoader {
  async load() {
    return PRESSURE_TEST_IDENTITY;
  }
}

class ScenarioEmotionRepository {
  constructor(state) {
    this.state = state;
  }

  async getForChannel() {
    return this.state;
  }

  async getForServer() {
    return this.state;
  }

  async getGlobal() {
    return this.state;
  }
}

function user(content) {
  return { authorPlatformId: USER_ID, content };
}

function parseArgs(argv) {
  const args = {
    allPrompts: false,
    help: false,
    listPrompts: false,
    listScenarios: false,
    live: false,
    prompts: [],
    runs: DEFAULT_RUNS,
    scenarios: [],
    showContext: false,
    tags: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--all-prompts") {
      args.allPrompts = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--list-prompts") {
      args.listPrompts = true;
    } else if (arg === "--list-scenarios") {
      args.listScenarios = true;
    } else if (arg === "--live") {
      args.live = true;
    } else if (arg === "--prompt" || arg === "--prompts") {
      args.prompts.push(...parseList(argv[++i]));
    } else if (arg === "--runs") {
      args.runs = parsePositiveInt(argv[++i], "--runs");
    } else if (arg === "--scenario" || arg === "--scenarios") {
      args.scenarios.push(...parseList(argv[++i]));
    } else if (arg === "--show-context") {
      args.showContext = true;
    } else if (arg === "--tag" || arg === "--tags") {
      args.tags.push(...parseList(argv[++i]));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parseList(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

async function listAvailablePrompts() {
  const entries = await fs.readdir(PROMPTS_DIR, { withFileTypes: true });
  const prompts = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sequencePath = path.join(
      PROMPTS_DIR,
      entry.name,
      "chat",
      "sequence.js",
    );

    try {
      await fs.access(sequencePath);
      prompts.push(entry.name);
    } catch {
      // Not a runnable chat prompt set.
    }
  }

  return prompts.sort();
}

function resolvePromptNames(args, availablePrompts) {
  if (args.allPrompts) return availablePrompts;

  const promptNames =
    args.prompts.length > 0
      ? args.prompts
      : [configManager.get("ai.chat.prompt") || "default"];

  return [...new Set(promptNames)];
}

function resolveScenarios(args) {
  let selected = pressureScenarios;

  if (args.scenarios.length > 0) {
    const wanted = new Set(args.scenarios);
    selected = selected.filter((scenario) => wanted.has(scenario.id));
  }

  if (args.tags.length > 0) {
    const wantedTags = new Set(args.tags);
    selected = selected.filter((scenario) =>
      scenario.tags?.some((tag) => wantedTags.has(tag)),
    );
  }

  return selected;
}

function assertKnownPrompts(promptNames, availablePrompts) {
  const available = new Set(availablePrompts);
  const missing = promptNames.filter((prompt) => !available.has(prompt));

  if (missing.length === 0) return;

  throw new Error(
    [
      `Unknown prompt set: ${missing.join(", ")}`,
      `Available prompt sets: ${availablePrompts.join(", ")}`,
      "A prompt set must contain content/prompts/<name>/chat/sequence.js.",
    ].join("\n"),
  );
}

function assertScenariosSelected(args, selected) {
  if (selected.length > 0) return;

  const filters = [
    args.scenarios.length ? `scenario=${args.scenarios.join(",")}` : null,
    args.tags.length ? `tag=${args.tags.join(",")}` : null,
  ].filter(Boolean);

  throw new Error(`No scenarios matched: ${filters.join(" ")}`);
}

function createRenderConfig() {
  return {
    getAll: () => ({
      language: "ko-KR",
    }),
  };
}

function createLiveClient() {
  return {
    model: createLanguageModel(configManager, "chat"),
    settings: getAiSettings(configManager, "chat"),
  };
}

async function buildScenarioContext(promptName, scenario) {
  const composer = new PromptComposer(
    new StaticCharacterLoader(),
    new ScenarioEmotionRepository(scenario.emotion),
    createRenderConfig(),
  );
  const builder = new SequenceBuilder(composer);
  const sequence = await builder.loadSequence(promptName);

  return builder.build(sequence, {
    historyMessages: scenario.history,
    pendingMessages: [user(scenario.pending)],
    botId: BOT_ID,
    channelRecord: { id: "pressure-test-channel", scope: "channel" },
    userRecord: scenario.relationship,
    promptName,
    data: {
      lorebooks: "Pressure test sandbox. No extra lore.",
      memories: scenario.memories,
    },
  });
}

async function callModel(client, context, systemInstruction) {
  const result = await generateText({
    model: client.model,
    system: systemInstruction,
    messages: toModelMessages(context),
    ...getGenerationSettings(client.settings),
  });

  return result.text;
}

function parseMarkdownResponse(text) {
  const messagesMatch = text.match(/## messages\s*\n([\s\S]*?)(?=\n##|$)/i);
  const emotionDeltaMatch = text.match(
    /## emotion_delta\s*\n([\s\S]*?)(?=\n##|$)/i,
  );
  const relationshipDeltaMatch = text.match(
    /## relationship_delta\s*\n([\s\S]*?)(?=\n##|$)/i,
  );

  const emotionKeys = parseKeys(emotionDeltaMatch);
  const relationshipKeys = parseKeys(relationshipDeltaMatch);
  const messagesText = messagesMatch?.[1]?.trim() ?? "";
  const messages = messagesText
    ? messagesText
        .split("[BREAK]")
        .map((message) => message.trim())
        .filter(Boolean)
    : [];

  return {
    emotionKeys,
    extraEmotionKeys: diff(emotionKeys, EXPECTED_EMOTION_KEYS),
    extraRelationshipKeys: diff(relationshipKeys, EXPECTED_RELATIONSHIP_KEYS),
    hasEmotionDelta: Boolean(emotionDeltaMatch),
    hasMessageNewline: messagesText ? /\n/.test(messagesText) : true,
    hasMessages: Boolean(messagesMatch),
    hasRelationshipDelta: Boolean(relationshipDeltaMatch),
    messageCount: messages.length,
    messages,
    missingEmotionKeys: diff(EXPECTED_EMOTION_KEYS, emotionKeys),
    missingRelationshipKeys: diff(EXPECTED_RELATIONSHIP_KEYS, relationshipKeys),
    relationshipKeys,
  };
}

function parseKeys(match) {
  if (!match) return [];

  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.split(":")[0]?.trim())
    .filter(Boolean);
}

function diff(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((key) => !actualSet.has(key));
}

function printHelp(availablePrompts) {
  console.log(
    [
      "Usage: node scripts/promptPressureTest.js [options]",
      "",
      "Prompt options:",
      "  --prompt name                 Run one prompt set.",
      "  --prompt a,b,c                Run multiple prompt sets.",
      "  --prompt a --prompt b         Run multiple prompt sets.",
      "  --all-prompts                 Run every prompt set with chat/sequence.js.",
      "  --list-prompts                Print available prompt sets.",
      "",
      "Scenario options:",
      "  --scenario id                 Run one scenario.",
      "  --scenario a,b,c              Run multiple scenarios.",
      "  --tag tag                     Run scenarios containing a tag.",
      "  --list-scenarios              Print scenario ids and tags.",
      "",
      "Execution options:",
      "  --live                        Call the configured chat model.",
      `  --runs n                      Calls per scenario in live mode. Default: ${DEFAULT_RUNS}.`,
      "  --show-context                Print assembled context preview.",
      "",
      "Without --live, this validates prompt assembly and prints the test inputs.",
      "With --live, each prompt/scenario pair is called --runs times.",
      "Execution order is scenario-first: each scenario runs across all selected prompts before moving to the next scenario.",
      "",
      "Available prompt sets:",
      ...availablePrompts.map((prompt) => `  - ${prompt}`),
    ].join("\n"),
  );
}

function printScenarioList() {
  for (const scenario of pressureScenarios) {
    console.log(
      `${scenario.id} | ${scenario.title} | tags=${scenario.tags.join(",")}`,
    );
  }
}

function printRunHeader({
  promptName,
  runIndex,
  scenario,
  systemInstruction,
  context,
}) {
  console.log(`\n=== ${scenario.id} :: run ${runIndex} ===`);
  console.log(scenario.title);
  console.log(`prompt=${promptName}`);
  console.log(`tags=${scenario.tags.join(",")}`);
  console.log(`systemInstruction=${systemInstruction.length} chars`);
  console.log(`context=${context.length} messages`);
  printScenarioState(scenario);
}

function printScenarioState(scenario) {
  console.log("\n--- state ---");
  console.log(`emotion=${formatState(scenario.emotion)}`);
  console.log(`relationship=${formatState(scenario.relationship)}`);
  console.log(`memory=${scenario.memories}`);
  console.log("\n--- previous chat ---");
  for (const message of scenario.history) {
    console.log(
      `${formatAuthor(message.authorPlatformId)}: ${message.content}`,
    );
  }
  console.log("\n--- current user message ---");
  console.log(`user: ${scenario.pending}`);
}

function formatState(state) {
  return Object.entries(state)
    .map(([key, value]) => `${key}:${value}`)
    .join(", ");
}

function formatAuthor(authorPlatformId) {
  return authorPlatformId === BOT_ID ? "bot" : "user";
}

function printParsedChecks(parsed) {
  console.log("\n--- checks ---");
  console.log(
    JSON.stringify(
      {
        messageCount: parsed.messageCount,
        hasMessageNewline: parsed.hasMessageNewline,
        hasMessages: parsed.hasMessages,
        hasEmotionDelta: parsed.hasEmotionDelta,
        missingEmotionKeys: parsed.missingEmotionKeys,
        extraEmotionKeys: parsed.extraEmotionKeys,
        hasRelationshipDelta: parsed.hasRelationshipDelta,
        missingRelationshipKeys: parsed.missingRelationshipKeys,
        extraRelationshipKeys: parsed.extraRelationshipKeys,
      },
      null,
      2,
    ),
  );
}

async function runDryCase({ promptName, scenario, args }) {
  const { systemInstruction, context } = await buildScenarioContext(
    promptName,
    scenario,
  );

  printRunHeader({
    promptName,
    runIndex: `dry/${args.runs}`,
    scenario,
    systemInstruction,
    context,
  });

  if (args.showContext) {
    printContextPreview(context);
  }
}

function printContextPreview(context) {
  console.log("\n--- assembled context preview ---");
  context.forEach((message, index) => {
    const content = String(message.content ?? "").replace(/\s+/g, " ");
    console.log(
      `${String(index + 1).padStart(2, "0")} ${message.role}: ${content.slice(0, 180)}`,
    );
  });
}

async function runLiveCase({ promptName, scenario, args, client }) {
  let failures = 0;

  for (let runIndex = 1; runIndex <= args.runs; runIndex += 1) {
    const { systemInstruction, context } = await buildScenarioContext(
      promptName,
      scenario,
    );

    printRunHeader({
      promptName,
      runIndex: `${runIndex}/${args.runs}`,
      scenario,
      systemInstruction,
      context,
    });

    if (args.showContext) {
      printContextPreview(context);
    }

    try {
      const text = await callModel(client, context, systemInstruction);
      const parsed = parseMarkdownResponse(text);

      console.log("\n--- raw ---");
      console.log(text.trim());
      printParsedChecks(parsed);
    } catch (error) {
      failures += 1;
      console.error("\n--- error ---");
      console.error(error);
    }
  }

  return failures;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const availablePrompts = await listAvailablePrompts();

  if (args.help) {
    printHelp(availablePrompts);
    return;
  }

  if (args.listPrompts) {
    console.log(availablePrompts.join("\n"));
    return;
  }

  if (args.listScenarios) {
    printScenarioList();
    return;
  }

  const promptNames = resolvePromptNames(args, availablePrompts);
  assertKnownPrompts(promptNames, availablePrompts);

  const selectedScenarios = resolveScenarios(args);
  assertScenariosSelected(args, selectedScenarios);

  const client = args.live ? createLiveClient() : null;
  let failures = 0;

  for (const scenario of selectedScenarios) {
    console.log(`\n######## scenario: ${scenario.id} ########`);
    console.log(scenario.title);

    for (const promptName of promptNames) {
      if (args.live) {
        failures += await runLiveCase({ promptName, scenario, args, client });
      } else {
        await runDryCase({ promptName, scenario, args });
      }
    }
  }

  if (!args.live) {
    console.log(
      `\nDry run only. Add --live to call the configured chat model. Live mode will call each case ${args.runs} time(s).`,
    );
  }

  if (failures > 0) {
    process.exitCode = 1;
    console.error(`\n${failures} live call(s) failed.`);
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    configManager.close();
  });
