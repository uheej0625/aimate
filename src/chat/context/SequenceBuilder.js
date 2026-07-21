import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("SequenceBuilder");

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
   * @param {Object} options - { historyMessages, pendingMessages, botId, cronMessage, channelRecord, promptName, data }
   * @returns {Promise<{ systemInstruction: string, context: Array }>}
   */
  async build(
    sequenceDef,
    {
      historyMessages = [],
      pendingMessages = [],
      botId,
      cronMessage,
      channelRecord,
      promptName,
      data = {},
    },
  ) {
    if (typeof promptName !== "string" || promptName.trim() === "") {
      throw new Error("A chat prompt name is required to build a sequence.");
    }

    let systemInstruction = "";
    let systemInstructionSet = false;
    const context = [];
    const promptDir = this.resolvePromptDir(promptName.trim());

    const renderOptions = { channelRecord, data };
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
      } else if (step.type === "cache-point") {
        // Explicit no-op until a provider supports prompt caching metadata.
        continue;
      } else if (step.type === "history") {
        let slicedHistory = historyMessages;
        if (step.slice && Array.isArray(step.slice)) {
          slicedHistory = historyMessages.slice(...step.slice);
        }

        for (const msg of slicedHistory) {
          context.push({
            role: msg.authorPlatformId === botId ? "assistant" : "user",
            content: msg.content,
          });
        }
      } else if (step.type === "pending") {
        if (cronMessage) {
          context.push({
            role: "user",
            content: `[시스템: 예약된 작업 실행]\n이것은 이전에 등록된 cron job이 예약된 시각에 자동 실행된 것입니다.\n이 작업을 다시 예약하거나 새로운 cron job을 등록하지 마세요.\n\n${cronMessage}`,
          });
        }
        for (const msg of pendingMessages) {
          context.push({
            role: "user",
            content: msg.content,
          });
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
      }
    }

    if (systemSteps !== 1) {
      throw new Error(
        `Prompt sequence must contain exactly one system step; found ${systemSteps}.`,
      );
    }
  }
}
