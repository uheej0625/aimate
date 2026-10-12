import fs from "fs/promises";
import { renderTemplate } from "../../utils/renderTemplate.js";
import { buildTemplateContext } from "../../utils/templateContext.js";
import { CharacterContextBuilder } from "../../character/CharacterContextBuilder.js";

export class PromptComposer {
  /**
   * @param {import('../../config/ConfigManager.js').default} [configManager]
   * @param {CharacterContextBuilder} [characterContextBuilder]
   */
  constructor(
    configManager = null,
    characterContextBuilder = null,
  ) {
    this.configManager = configManager;
    this.characterContextBuilder =
      characterContextBuilder ?? new CharacterContextBuilder({ configManager });
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
   * @param {Date} [options.referenceDate]
   * @returns {Promise<Object>}
   */
  async buildContext({ data = {}, referenceDate = new Date() } = {}) {
    const config = this.configManager?.getAll?.() ?? {};
    const characterConfig = await this.characterContextBuilder.loadConfig();
    const context = buildTemplateContext(data, {
      referenceDate,
      timeZone: characterConfig.timezone,
    });
    const characterContext = await this.characterContextBuilder.build({
      system: context.system,
    });

    return {
      ...context,
      config,
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
    return renderTemplate(
      template,
      options.context ?? (await this.buildContext(options)),
    );
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
