import { generateImageFile } from "./images.js";
import { loadAiCredentials } from "./credentials.js";

/**
 * Generates image data through the configured AI image provider.
 */
export class ImageGenerator {
  constructor(
    configManager,
    {
      credentials = loadAiCredentials(),
      generateImageFileFn = generateImageFile,
    } = {},
  ) {
    this.configManager = configManager;
    this.credentials = credentials;
    this.generateImageFileFn = generateImageFileFn;
  }

  async generate(prompt, options = {}) {
    return this.generateImageFileFn(
      this.configManager,
      prompt,
      options,
      this.credentials,
    );
  }
}
