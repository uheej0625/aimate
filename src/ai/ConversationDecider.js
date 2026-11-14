import fs from "node:fs/promises";
import path from "node:path";
import { experimental_decide } from "ai";
import { getAiSettings } from "./config.js";
import { createDecisionModel } from "./models.js";
import { createLogger, elapsedMs } from "../core/logger.js";

const logger = createLogger("ConversationDecider");

export class ConversationDecider {
  constructor(
    configManager,
    credentials,
    decide = experimental_decide,
    { promptsRoot = "content/prompts" } = {},
  ) {
    this.settings = getAiSettings(configManager, "decision");
    this.decide = decide;
    this.promptsRoot = path.resolve(promptsRoot);
    this.model = createDecisionModel(configManager, credentials);
  }

  async loadPrompt() {
    const name = this.settings.prompt;
    if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name))
      throw new Error("ai.decision.prompt must be a prompt pack name.");
    const file = path.join(this.promptsRoot, name, "decision", "prompt.json");
    const prompt = JSON.parse(await fs.readFile(file, "utf8"));
    if (typeof prompt.instructions !== "string" || !prompt.instructions.trim())
      throw new Error(`Decision prompt instructions are required: ${file}`);
    for (const [mode, actions] of Object.entries({
      idle: ["respond", "wait", "ignore"],
      active: ["keep", "restart", "stop", "wait"],
    })) {
      const criteria = prompt[mode];
      if (
        !criteria ||
        Object.keys(criteria).length !== actions.length ||
        actions.some(
          (action) =>
            typeof criteria[action] !== "string" || !criteria[action].trim(),
        )
      )
        throw new Error(
          `Decision prompt ${mode} criteria must define ${actions.join(", ")}: ${file}`,
        );
    }
    this.prompt = prompt;
    return prompt;
  }

  async evaluate(state, abortSignal) {
    const prompt = this.prompt ?? (await this.loadPrompt());
    abortSignal.throwIfAborted();
    const criteria = state.assistant.active ? prompt.active : prompt.idle;
    const startedAt = performance.now();
    const result = await this.decide({
      model: this.model,
      state,
      questions: {
        action: {
          type: "choice",
          instructions: prompt.instructions,
          criteria,
        },
      },
      providerOptions: this.settings.providerOptions,
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        abortSignal,
        AbortSignal.timeout(this.settings.timeoutMs),
      ]),
    });
    const answer = result.answers.action;
    if (!Object.hasOwn(criteria, answer.choice))
      throw new Error("Invalid conversation decision action.");
    logger.info(
      {
        event: "decision.completed",
        provider: this.settings.provider,
        model: this.settings.model,
        action: answer.choice,
        probabilities: answer.probabilities,
        durationMs: elapsedMs(startedAt),
        inputTokens: result.usage?.inputTokens,
      },
      "Conversation decision completed",
    );
    return answer.choice;
  }
}
