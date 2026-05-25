/**
 * Chat-only facade: prepares model context and runs the tool-aware chat loop.
 */
export class ChatGenerationService {
  constructor({
    chatContextPreparer,
    chatGenerationRunner,
    chatModel,
    toolRegistry = null,
    toolExecutor = null,
    aiService = null,
  }) {
    this.chatContextPreparer = chatContextPreparer;
    this.chatGenerationRunner = chatGenerationRunner;
    this.chatModel = chatModel;
    this.toolRegistry = toolRegistry;
    this.toolExecutor = toolExecutor;
    this.aiService = aiService;
  }

  async prepareContext(
    internalChannelId,
    botId,
    channelRecord = null,
    cronMessage = null,
  ) {
    return await this.chatContextPreparer.prepare(
      internalChannelId,
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
    return await this.chatGenerationRunner.run({
      chatModel: this.chatModel,
      context,
      systemInstruction,
      platform,
      channelRecord,
      toolRegistry: this.toolRegistry,
      toolExecutor: this.toolExecutor,
      aiService: this.aiService,
    });
  }
}
