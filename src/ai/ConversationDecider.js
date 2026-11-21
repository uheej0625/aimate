import fs from "node:fs/promises";
import path from "node:path";
import { experimental_decide } from "ai";
import { getAiSettings } from "./config.js";
import { createDecisionModel } from "./models.js";
import { serializeMetadata } from "./metadata.js";
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
    for (const key of ["instructions", "recheckInstructions"]) {
      if (typeof prompt[key] !== "string" || !prompt[key].trim())
        throw new Error(`Decision prompt ${key} is required: ${file}`);
    }
    for (const [mode, actions] of Object.entries({
      idle: ["respond", "wait", "ignore"],
      directIdle: ["respond", "wait", "ignore"],
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

  async evaluate(state, abortSignal, onRequest = async () => {}) {
    const prompt = this.prompt ?? (await this.loadPrompt());
    abortSignal.throwIfAborted();
    const criteria = state.assistant.active
      ? prompt.active
      : state.isDirect
        ? prompt.directIdle
        : prompt.idle;
    const instructions =
      state.recheckCount > 0
        ? `${prompt.instructions}\n\n${prompt.recheckInstructions}`
        : prompt.instructions;
    const request = {
      state,
      questions: {
        action: {
          type: "choice",
          instructions,
          criteria,
        },
      },
      providerOptions: this.settings.providerOptions,
      maxRetries: 0,
    };
    await onRequest({
      provider: this.settings.provider,
      model: this.settings.model,
      prompt: this.settings.prompt,
      timeoutMs: this.settings.timeoutMs,
      ...request,
    });
    abortSignal.throwIfAborted();
    const startedAt = performance.now();
    const result = await this.decide({
      ...request,
      model: this.model,
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
    return {
      action: answer.choice,
      probabilities: answer.probabilities,
      usage: result.usage,
      durationMs: elapsedMs(startedAt),
      apiResponse: serializeMetadata(result),
    };
  }
}
