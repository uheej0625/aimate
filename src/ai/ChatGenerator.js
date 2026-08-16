import { AIResponseParser } from "../chat/response/AIResponseParser.js";
import { GeneratedImageTagPolicy } from "../chat/response/GeneratedImageTagPolicy.js";
import { generateChatReply } from "./chat.js";

/**
 * Generates model responses for prepared chat context.
 */
export class ChatGenerator {
  constructor({
    configManager,
    toolRegistry = null,
    toolContextFactory = null,
    responseParser = new AIResponseParser(),
    generatedImageTagPolicy = new GeneratedImageTagPolicy(),
    generateTextFn = undefined,
    createLanguageModelFn = undefined,
  }) {
    this.configManager = configManager;
    this.toolRegistry = toolRegistry;
    this.toolContextFactory = toolContextFactory;
    this.responseParser = responseParser;
    this.generatedImageTagPolicy = generatedImageTagPolicy;
    this.generateTextFn = generateTextFn;
    this.createLanguageModelFn = createLanguageModelFn;
  }

  async generate(
    context,
    systemInstruction,
    platform = "cli",
    channelRecord = null,
    { abortSignal } = {},
  ) {
    return generateChatReply({
      configManager: this.configManager,
      context,
      systemInstruction,
      platform,
      channelRecord,
      toolRegistry: this.toolRegistry,
      toolContext: this.toolContextFactory?.create({
        platform,
        channel: channelRecord,
      }),
      responseParser: this.responseParser,
      generatedImageTagPolicy: this.generatedImageTagPolicy,
      generateTextFn: this.generateTextFn,
      createLanguageModelFn: this.createLanguageModelFn,
      abortSignal,
    });
  }
}
