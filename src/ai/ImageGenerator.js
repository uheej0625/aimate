import { generateImageFile } from "./images.js";

/**
 * Generates image data through the configured AI image provider.
 */
export class ImageGenerator {
  constructor(configManager, { generateImageFileFn = generateImageFile } = {}) {
    this.configManager = configManager;
    this.generateImageFileFn = generateImageFileFn;
  }

  async generate(prompt, options = {}) {
    return this.generateImageFileFn(this.configManager, prompt, options);
  }
}
