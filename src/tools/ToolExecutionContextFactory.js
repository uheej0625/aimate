import { getRequiredCharacterId } from "../character/config.js";

/**
 * Creates the per-request dependencies exposed to application tools.
 */
export class ToolExecutionContextFactory {
  constructor({
    configManager,
    imageGenerator = null,
    generationRepository = null,
    messageActionService = null,
    platformClients = new Map(),
  }) {
    this.configManager = configManager;
    this.imageGenerator = imageGenerator;
    this.generationRepository = generationRepository;
    this.messageActionService = messageActionService;
    this.platformClients = platformClients;
    this.characterId = getRequiredCharacterId(configManager);
  }

  create({
    platform,
    channel = null,
    requestCreatedAt = new Date(),
    abortSignal = undefined,
    channelPort,
    generationId,
    delivery,
  }) {
    return {
      platform,
      platformClient: this.platformClients.get(platform) ?? null,
      platformClients: this.platformClients,
      configManager: this.configManager,
      imageGenerator: this.imageGenerator,
      generationRepository: this.generationRepository,
      messageActionService: this.messageActionService,
      channelPort,
      generationId,
      delivery,
      channel,
      requestCreatedAt,
      characterId: this.characterId,
      abortSignal,
    };
  }
}
