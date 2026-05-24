import fs from "fs/promises";
import { EMOTION_KEYS } from "../engines/emotion/EmotionEngine.js";
import { RELATIONSHIP_KEYS } from "../engines/relationship/RelationshipEngine.js";
import { createLogger } from "../core/logger.js";
import {
  buildRuntimeContext,
  buildSystemContext,
  renderTemplate,
} from "../utils/renderTemplate.js";
import { CharacterContextBuilder } from "./CharacterContextBuilder.js";

const logger = createLogger("PromptComposer");

const DEFAULT_RELATIONSHIP = {
  affinity: 30,
  trust: 30,
  affection: 20,
};

export class PromptComposer {
  /**
   * @param {import('../repositories/EmotionStateRepository.js').EmotionStateRepository} [emotionStateRepository]
   * @param {import('../config/ConfigManager.js').default} [configManager]
   * @param {CharacterContextBuilder} [characterContextBuilder]
   */
  constructor(
    emotionStateRepository = null,
    configManager = null,
    characterContextBuilder = new CharacterContextBuilder(),
  ) {
    this.emotionStateRepository = emotionStateRepository;
    this.configManager = configManager;
    this.characterContextBuilder = characterContextBuilder;
  }

  /**
   * Build the full prompt context used by chat prompt templates.
   *
   * Supported namespaces:
   * - data.*
   * - system.now.*
   * - runtime.*
   * - config.*
   * - character.* / character.identity / character.emotionalState
   * - user.relationshipState
   *
   * @param {Object} [options]
   * @param {Object} [options.data]
   * @param {Object|null} [options.channelRecord]
   * @param {Object|null} [options.userRecord]
   * @returns {Promise<Object>}
   */
  async buildContext({
    data = {},
    channelRecord = null,
    userRecord = null,
  } = {}) {
    const system = buildSystemContext();
    const characterContext = await this.characterContextBuilder.build({
      system,
    });
    const emotionalState = await this.resolveEmotionalState(channelRecord);
    const relationshipState = this.resolveRelationshipState(userRecord);

    return {
      data,
      system,
      runtime: buildRuntimeContext(),
      config: this.configManager?.getAll?.() ?? {},
      character: {
        ...characterContext,
        emotionalState,
        toString: () => characterContext.identity,
      },
      user: {
        ...(userRecord ?? {}),
        relationshipState,
      },
    };
  }

  /**
   * @param {string} template
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async render(template, options = {}) {
    return renderTemplate(template, await this.buildContext(options));
  }

  /**
   * @param {string} filePath
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async renderFile(filePath, options = {}) {
    try {
      const template = await fs.readFile(filePath, "utf-8");
      return this.render(template, options);
    } catch (e) {
      logger.warn({ err: e, filePath }, "Failed to read prompt file");
      return "";
    }
  }

  /**
   * @param {Object|null} channelRecord
   * @returns {Promise<string>}
   */
  async resolveEmotionalState(channelRecord) {
    const fallback = EMOTION_KEYS.map((key) => `${key}: 50`).join("\n");

    if (!this.emotionStateRepository || !channelRecord?.id) return fallback;

    try {
      const scope = channelRecord.scope ?? "channel";
      let state;

      if (scope === "global") {
        state = await this.emotionStateRepository.getGlobal();
      } else if (scope === "server" && channelRecord.serverId) {
        state = await this.emotionStateRepository.getForServer(
          channelRecord.serverId,
        );
      } else {
        state = await this.emotionStateRepository.getForChannel(
          channelRecord.id,
        );
      }

      return EMOTION_KEYS.map((key) => `${key}: ${state[key]}`).join("\n");
    } catch (e) {
      logger.warn({ err: e }, "Failed to load emotion state");
      return fallback;
    }
  }

  /**
   * @param {Object|null} userRecord
   * @returns {string}
   */
  resolveRelationshipState(userRecord) {
    return RELATIONSHIP_KEYS.map((key) => {
      const value = userRecord?.[key];
      return `${key}: ${
        typeof value === "number" ? value : DEFAULT_RELATIONSHIP[key]
      }`;
    }).join("\n");
  }
}
