import { getRequiredCharacterId } from "../character/config.js";

/**
 * Creates the per-request dependencies exposed to application tools.
 */
export class ToolExecutionContextFactory {
  constructor({
    configManager,
    cronJobScheduler = null,
    imageGenerator = null,
    generationRepository = null,
    platformClients = new Map(),
  }) {
    this.configManager = configManager;
    this.cronJobScheduler = cronJobScheduler;
    this.imageGenerator = imageGenerator;
    this.generationRepository = generationRepository;
    this.platformClients = platformClients;
    this.characterId = getRequiredCharacterId(configManager);
  }

  create({ platform, channel = null, requestCreatedAt = new Date() }) {
    return {
      platform,
      platformClient: this.platformClients.get(platform) ?? null,
      platformClients: this.platformClients,
      configManager: this.configManager,
      cronJobScheduler: this.cronJobScheduler,
      imageGenerator: this.imageGenerator,
      generationRepository: this.generationRepository,
      channel,
      requestCreatedAt,
      characterId: this.characterId,
    };
  }
}
