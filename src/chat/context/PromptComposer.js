import fs from "fs/promises";
import {
  buildRuntimeContext,
  buildSystemContext,
  renderTemplate,
} from "../../utils/renderTemplate.js";
import { CharacterContextBuilder } from "../../character/CharacterContextBuilder.js";

export class PromptComposer {
  /**
   * @param {import('../../config/ConfigManager.js').default} [configManager]
   * @param {CharacterContextBuilder} [characterContextBuilder]
   */
  constructor(
    configManager = null,
    characterContextBuilder = new CharacterContextBuilder(),
  ) {
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
   * - character.* / character.identity
   *
   * @param {Object} [options]
   * @param {Object} [options.data]
   * @returns {Promise<Object>}
   */
  async buildContext({ data = {} } = {}) {
    const system = buildSystemContext();
    const characterContext = await this.characterContextBuilder.build({
      system,
    });

    return {
      data,
      system,
      runtime: buildRuntimeContext(),
      config: this.configManager?.getAll?.() ?? {},
      character: {
        ...characterContext,
        toString: () => characterContext.identity,
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
    const template = await fs.readFile(filePath, "utf-8");
    return this.render(template, options);
  }
}
