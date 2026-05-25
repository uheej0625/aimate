import { PromptComposer } from "./PromptComposer.js";
import { SequenceBuilder } from "./SequenceBuilder.js";
import { AIModelFactory } from "./AIModelFactory.js";
import { AIResponseParser } from "./AIResponseParser.js";
import { ChatContextPreparer } from "./ChatContextPreparer.js";
import { ChatGenerationService } from "./ChatGenerationService.js";
import { GeneratedImageTagPolicy } from "./GeneratedImageTagPolicy.js";
import { ToolCallingChatRunner } from "./ToolCallingChatRunner.js";

/**
 * Model facade kept for shared AI capabilities such as image generation.
 * Chat orchestration lives in ChatGenerationService.
 */
export class AIService {
  /**
   * @param {import('../services/HistoryService.js').HistoryService} historyService
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {import('../tools/ToolRegistry.js').ToolRegistry} [toolRegistry]
   * @param {import('../tools/ToolExecutor.js').ToolExecutor} [toolExecutor]
   * @param {import('./PromptComposer.js').PromptComposer} [promptComposer]
   * @param {import('../repositories/UserRepository.js').UserRepository} [userRepository]
   * @param {import('./SequenceBuilder.js').SequenceBuilder} [sequenceBuilder]
   * @param {Object} [options]
   * @param {import('./AIModelFactory.js').AIModelFactory} [options.modelFactory]
   * @param {import('./AIResponseParser.js').AIResponseParser} [options.responseParser]
   * @param {import('./GeneratedImageTagPolicy.js').GeneratedImageTagPolicy} [options.generatedImageTagPolicy]
   * @param {import('./ChatContextPreparer.js').ChatContextPreparer} [options.chatContextPreparer]
   * @param {import('./ToolCallingChatRunner.js').ToolCallingChatRunner} [options.chatGenerationRunner]
   * @param {Object} [options.chatModel]
   * @param {Object} [options.imageModel]
   */
  constructor(
    historyService,
    configManager,
    toolRegistry = null,
    toolExecutor = null,
    promptComposer = null,
    userRepository = null,
    sequenceBuilder = null,
    {
      modelFactory = null,
      responseParser = null,
      generatedImageTagPolicy = null,
      chatContextPreparer = null,
      chatGenerationRunner = null,
      chatModel = null,
      imageModel = null,
    } = {},
  ) {
    this.configManager = configManager;
    this.historyService = historyService;
    this.toolRegistry = toolRegistry;
    this.toolExecutor = toolExecutor;
    this.promptComposer =
      promptComposer ?? new PromptComposer(null, configManager);
    this.sequenceBuilder =
      sequenceBuilder ?? new SequenceBuilder(this.promptComposer);
    this.userRepository = userRepository;
    this.modelFactory = modelFactory ?? new AIModelFactory(configManager);
    this.responseParser = responseParser ?? new AIResponseParser();
    this.generatedImageTagPolicy =
      generatedImageTagPolicy ?? new GeneratedImageTagPolicy();
    this.chatContextPreparer =
      chatContextPreparer ??
      new ChatContextPreparer(
        historyService,
        configManager,
        this.sequenceBuilder,
        userRepository,
      );
    this.chatGenerationRunner =
      chatGenerationRunner ??
      new ToolCallingChatRunner(configManager, {
        responseParser: this.responseParser,
        generatedImageTagPolicy: this.generatedImageTagPolicy,
      });

    this.chatModel = chatModel ?? this.createModel("chat");
    this.imageModel = imageModel ?? this.createModel("image");
    this.chatGenerationService = new ChatGenerationService({
      chatContextPreparer: this.chatContextPreparer,
      chatGenerationRunner: this.chatGenerationRunner,
      chatModel: this.chatModel,
      toolRegistry: this.toolRegistry,
      toolExecutor: this.toolExecutor,
      aiService: this,
    });
    //this.summaryModel = this.createModel("summary");
    //this.embeddingModel = this.createModel("embedding");
  }

  /**
   * Prepare the context and system instruction for a reply.
   * @param {string} channelId - Internal channel ID
   * @param {string} botId
   * @param {Object} [channelRecord] - 내부 Channel 레코드 (emotion state 조회용)
   * @param {string} [cronMessage] - Cron job에서 전달되는 시스템 메시지 (선택)
   * @returns {Promise<{context: Array, systemInstruction: string, messageIds: Array, inputMessages: Array<string>, currentUserId: string|null}>}
   */
  async prepareContext(
    channelId,
    botId,
    channelRecord = null,
    cronMessage = null,
  ) {
    return await this.chatGenerationService.prepareContext(
      channelId,
      botId,
      channelRecord,
      cronMessage,
    );
  }

  /**
   * AI 응답을 생성하고 파싱된 결과를 반환한다.
   *
   * Tools가 활성화된 경우 agentic loop를 실행한다:
   *   1. AI 호출 -> tool_call 이벤트 감지
   *   2. 툴 실행 후 결과를 ephemeral context에 추가
   *   3. 다시 AI 호출 (최대 tools.maxSteps회)
   *   4. 최종 텍스트 응답을 마크다운 계약으로 파싱 후 반환
   *
   * @param {Array} context
   * @param {string} systemInstruction
   * @param {string} [platform='cli']
   * @param {Object} [channelRecord]
   * @returns {Promise<{messages: string[], emotionDelta: Object, emotionReason: string}>}
   */
  async generateChat(
    context,
    systemInstruction,
    platform = "cli",
    channelRecord = null,
  ) {
    this.chatGenerationService.chatModel = this.chatModel;
    this.chatGenerationService.toolRegistry = this.toolRegistry;
    this.chatGenerationService.toolExecutor = this.toolExecutor;
    return await this.chatGenerationService.generateChat(
      context,
      systemInstruction,
      platform,
      channelRecord,
    );
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

  createModel(purpose) {
    return this.modelFactory.create(purpose);
  }

  async generateImage(prompt, options = {}) {
    return this.imageModel.generateImage(prompt, options);
  }
}
