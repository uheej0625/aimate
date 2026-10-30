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
    participantService = null,
    platformClients = new Map(),
  }) {
    this.configManager = configManager;
    this.imageGenerator = imageGenerator;
    this.generationRepository = generationRepository;
    this.messageActionService = messageActionService;
    this.participantService = participantService;
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
    participantResolver,
  }) {
    return {
      platform,
      platformClient: this.platformClients.get(platform) ?? null,
      platformClients: this.platformClients,
      configManager: this.configManager,
      imageGenerator: this.imageGenerator,
      generationRepository: this.generationRepository,
      messageActionService: this.messageActionService,
      participantService: this.participantService,
      participantResolver,
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
