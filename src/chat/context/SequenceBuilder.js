import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("SequenceBuilder");
const OBSERVATION_TIME_GAP_MS = 5 * 60 * 1000;

export class SequenceBuilder {
  /**
   * @param {import('./PromptComposer.js').PromptComposer} promptComposer
   */
  constructor(promptComposer, { promptsRoot = "content/prompts" } = {}) {
    this.promptComposer = promptComposer;
    this.promptsRoot = path.resolve(process.cwd(), promptsRoot);
  }

  /**
   * sequence.js를 읽어 반환한다.
   * @param {string} promptName
   * @returns {Promise<Array>}
   */
  async loadSequence(promptName) {
    if (typeof promptName !== "string" || promptName.trim() === "") {
      throw new Error("A chat prompt name is required to load a sequence.");
    }

    const promptDir = this.resolvePromptDir(promptName);
    const sequencePath = path.join(promptDir, "sequence.js");
    const imported = await import(pathToFileURL(sequencePath).href);
    const sequence = imported.default || imported;

    await this.validateSequence(sequence, promptDir);
    return sequence;
  }

  /**
   * sequence.js 명세에 따라 컨텍스트 배열을 조립한다.
   * @param {Array} sequenceDef
   * @param {Object} options - { historyMessages, pendingMessages, botId, channelRecord, promptName, data, referenceDate }
   * @returns {Promise<{ systemInstruction: string, context: Array }>}
   */
  async build(
    sequenceDef,
    {
      historyMessages = [],
      pendingMessages = [],
      botId,
      channelRecord,
      promptName,
      data = {},
      referenceDate = new Date(),
    },
  ) {
    if (typeof promptName !== "string" || promptName.trim() === "") {
      throw new Error("A chat prompt name is required to build a sequence.");
    }

    let systemInstruction = "";
    let systemInstructionSet = false;
    const context = [];
    const promptDir = this.resolvePromptDir(promptName.trim());

    const renderOptions = {
      channelRecord,
      data,
      context: await this.promptComposer.buildContext({ data, referenceDate }),
    };
    const { language = "ko-KR" } =
      renderOptions.context.config?.app ?? {};
    const timeZone = renderOptions.context.system?.now.timezone;
    const timeFormatter = new Intl.DateTimeFormat(language, {
      timeZone,
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    // Time markers follow event order, independent of response boundaries or slices.
    let previousMessage = null;
    const render = (message) => {
      const observation = renderObservation(
        message,
        botId,
        previousMessage,
        timeFormatter,
      );
      previousMessage = message;
      return observation;
    };
    const historyObservations = historyMessages.map(render);
    const pendingObservations = pendingMessages.map(render);

    const pushRendered = (role, rendered) => {
      if (!rendered) return;

      if (role === "system" && !systemInstructionSet) {
        systemInstruction = rendered;
        systemInstructionSet = true;
        return;
      }

      // duplicate system instructions fallback to user role, per spec
      context.push({
        role: role === "system" ? "user" : role || "user",
        content: rendered,
      });
    };

    for (const step of sequenceDef) {
      if (step.type === "file") {
        const filePath = path.join(promptDir, step.source);
        const rendered = await this.promptComposer.renderFile(
          filePath,
          renderOptions,
        );
        pushRendered(step.role, rendered);
      } else if (step.type === "text") {
        const rendered = await this.promptComposer.render(
          step.content ?? "",
          renderOptions,
        );
        pushRendered(step.role, rendered);
      } else if (step.type === "placeholder") {
        const template =
          step.template ??
          (String(step.source ?? "").includes("{{")
            ? String(step.source ?? "")
            : `{{${step.source}}}`);
        const rendered = await this.promptComposer.render(
          template,
          renderOptions,
        );
        pushRendered(step.role, rendered);
      } else if (step.type === "response") {
        const instructions = [];
        for (const source of step.sources) {
          instructions.push(
            await this.promptComposer.renderFile(
              path.join(promptDir, source),
              renderOptions,
            ),
          );
        }
        instructions.push(
          `## Current Time\n\n${renderOptions.context.system.now.raw}`,
        );
        pushRendered("user", instructions.join("\n\n"));
      } else if (step.type === "cache-point") {
        // Explicit no-op until a provider supports prompt caching metadata.
        continue;
      } else if (step.type === "history") {
        let slicedHistory = historyObservations;
        if (step.slice && Array.isArray(step.slice)) {
          slicedHistory = historyObservations.slice(...step.slice);
        }

        for (const msg of slicedHistory) {
          context.push(msg);
        }
      } else if (step.type === "pending") {
        for (const msg of pendingObservations) {
          context.push(msg);
        }
      } else {
        throw new Error(`Unsupported prompt sequence step type: ${step.type}`);
      }
    }

    return { systemInstruction, context };
  }

  resolvePromptDir(promptName) {
    return path.join(this.promptsRoot, promptName, "chat");
  }

  async validateSequence(sequence, promptDir) {
    if (!Array.isArray(sequence) || sequence.length === 0) {
      throw new Error("Prompt sequence must export a non-empty array.");
    }

    const supportedTypes = new Set([
      "file",
      "text",
      "placeholder",
      "cache-point",
      "history",
      "pending",
      "response",
    ]);
    let systemSteps = 0;

    for (const step of sequence) {
      if (!step || !supportedTypes.has(step.type)) {
        throw new Error(`Unsupported prompt sequence step type: ${step?.type}`);
      }

      if (step.role === "system") systemSteps++;

      if (step.type === "file") {
        if (!step.source) {
          throw new Error("Prompt file steps require a source.");
        }
        await fs.access(path.join(promptDir, step.source));
      } else if (step.type === "response") {
        if (!Array.isArray(step.sources) || step.sources.length === 0) {
          throw new Error("Response steps require prompt sources.");
        }
        for (const source of step.sources) {
          await fs.access(path.join(promptDir, source));
        }
      }
    }

    if (systemSteps !== 1) {
      throw new Error(
        `Prompt sequence must contain exactly one system step; found ${systemSteps}.`,
      );
    }
  }
}

function renderObservation(message, botId, previousMessage, timeFormatter) {
  const observedAt = message.createdAt ? new Date(message.createdAt) : null;
  const previousObservedAt = previousMessage?.createdAt
    ? new Date(previousMessage.createdAt)
    : null;
  const showTime =
    observedAt &&
    (!previousObservedAt ||
      observedAt - previousObservedAt >= OBSERVATION_TIME_GAP_MS);
  return {
    role: message.authorPlatformId === botId ? "assistant" : "user",
    content: showTime
      ? `[${timeFormatter.format(observedAt)}]\n${message.content}`
      : message.content,
  };
}
