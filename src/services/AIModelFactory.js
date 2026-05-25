import { AISDKProvider } from "../providers/AISDKProvider.js";
import { GoogleCloudProvider } from "../providers/GoogleCloudProvider.js";
import { OpenAIProvider } from "../providers/OpenAIProvider.js";
import { VertexProvider } from "../providers/VertexProvider.js";

/**
 * Creates provider-backed model instances for configured AI purposes.
 */
export class AIModelFactory {
  /**
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(configManager) {
    this.configManager = configManager;
  }

  create(purpose) {
    const config = this.configManager.get(`ai.${purpose}`);

    switch (config.provider) {
      case "googleCloud":
        return new GoogleCloudProvider(this.configManager, purpose);
      case "aiSdk":
        return new AISDKProvider(this.configManager, purpose);
      case "vertex":
        return new VertexProvider(this.configManager, purpose);
      case "openai":
        return new OpenAIProvider(this.configManager, purpose);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }
}
