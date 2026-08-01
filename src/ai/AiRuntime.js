import { PromptComposer } from "../chat/context/PromptComposer.js";
import { SequenceBuilder } from "../chat/context/SequenceBuilder.js";
import { AIResponseParser } from "../chat/response/AIResponseParser.js";
import { ChatContextPreparer } from "../chat/context/ChatContextPreparer.js";
import { GeneratedImageTagPolicy } from "../chat/response/GeneratedImageTagPolicy.js";
import { generateChatReply } from "./chat.js";
import { generateImageFile } from "./images.js";

export class AiRuntime {
  constructor({
    historyService,
    configManager,
    toolRegistry = null,
    promptComposer = null,
    sequenceBuilder = null,
    responseParser = null,
    generatedImageTagPolicy = null,
    chatContextPreparer = null,
    platformClients = new Map(),
    generationRepository = null,
    getCronService = () => null,
    generateTextFn = undefined,
    createLanguageModelFn = undefined,
  }) {
    this.configManager = configManager;
    this.historyService = historyService;
    this.toolRegistry = toolRegistry;
    this.platformClients = platformClients;
    this.generationRepository = generationRepository;
    this.getCronService = getCronService;
    this.generateTextFn = generateTextFn;
    this.createLanguageModelFn = createLanguageModelFn;
    this.promptComposer = promptComposer ?? new PromptComposer(configManager);
    this.sequenceBuilder =
      sequenceBuilder ?? new SequenceBuilder(this.promptComposer);
    this.responseParser = responseParser ?? new AIResponseParser();
    this.generatedImageTagPolicy =
      generatedImageTagPolicy ?? new GeneratedImageTagPolicy();
    this.chatContextPreparer =
      chatContextPreparer ??
      new ChatContextPreparer(
        historyService,
        configManager,
        this.sequenceBuilder,
      );
  }

  async prepareContext(
    channelId,
    botId,
    channelRecord = null,
    cronMessage = null,
  ) {
    return this.chatContextPreparer.prepare(
      channelId,
      botId,
      channelRecord,
      cronMessage,
    );
  }

  async generateChat(
    context,
    systemInstruction,
    platform = "cli",
    channelRecord = null,
  ) {
    return generateChatReply({
      configManager: this.configManager,
      context,
      systemInstruction,
      platform,
      channelRecord,
      toolRegistry: this.toolRegistry,
      toolContext: this.createToolContext(platform, channelRecord),
      responseParser: this.responseParser,
      generatedImageTagPolicy: this.generatedImageTagPolicy,
      generateTextFn: this.generateTextFn,
      createLanguageModelFn: this.createLanguageModelFn,
    });
  }

  createToolContext(platform, channelRecord = null) {
    return {
      platform,
      platformClient: this.platformClients.get(platform) ?? null,
      platformClients: this.platformClients,
      configManager: this.configManager,
      cronService: this.getCronService(),
      generationRepository: this.generationRepository,
      channel: channelRecord,
      requestCreatedAt: new Date(),
      ai: this,
    };
  }

  _parseAIResponse(text) {
    return this.responseParser.parse(text);
  }

  _extractGeneratedImageTags(toolResults = []) {
    return this.generatedImageTagPolicy.extractFromToolResults(toolResults);
  }

  _withGeneratedImageTags(parsed, generatedImageTags = []) {
    return this.generatedImageTagPolicy.appendMissingTags(
      parsed,
      generatedImageTags,
    );
  }

  async generateImage(prompt, options = {}) {
    return generateImageFile(this.configManager, prompt, options);
  }
}
