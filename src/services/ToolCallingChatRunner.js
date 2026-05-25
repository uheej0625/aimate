import { createLogger } from "../core/logger.js";
import { AIResponseParser } from "./AIResponseParser.js";
import { GeneratedImageTagPolicy } from "./GeneratedImageTagPolicy.js";

const logger = createLogger("ToolCallingChatRunner");

/**
 * Runs a provider chat stream, executes requested tools, and returns parsed text.
 */
export class ToolCallingChatRunner {
  /**
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {Object} [options]
   * @param {AIResponseParser} [options.responseParser]
   * @param {GeneratedImageTagPolicy} [options.generatedImageTagPolicy]
   */
  constructor(
    configManager,
    {
      responseParser = new AIResponseParser(),
      generatedImageTagPolicy = new GeneratedImageTagPolicy(),
    } = {},
  ) {
    this.configManager = configManager;
    this.responseParser = responseParser;
    this.generatedImageTagPolicy = generatedImageTagPolicy;
  }

  /**
   * @param {Object} params
   * @param {Object} params.chatModel
   * @param {Array} params.context
   * @param {string} params.systemInstruction
   * @param {string} [params.platform]
   * @param {Object|null} [params.channelRecord]
   * @param {import('../tools/ToolRegistry.js').ToolRegistry|null} [params.toolRegistry]
   * @param {import('../tools/ToolExecutor.js').ToolExecutor|null} [params.toolExecutor]
   * @param {Object|null} [params.aiService]
   * @returns {Promise<{messages: string[], emotionDelta: Object, emotionReason: string, relationshipDelta: Object, apiRequests: Array, apiResponses: Array}>}
   */
  async run({
    chatModel,
    context,
    systemInstruction,
    platform = "cli",
    channelRecord = null,
    toolRegistry = null,
    toolExecutor = null,
    aiService = null,
  }) {
    if (context.length === 0) {
      return { messages: ["..."], emotionDelta: {}, emotionReason: "" };
    }

    const stream = this.configManager.get("ai.chat.stream");
    const activeTools = toolRegistry
      ? toolRegistry.getActiveTools(platform)
      : [];
    const toolDeclarations = activeTools.map((tool) => tool.declaration);
    const maxSteps = this.configManager.get("tools.maxSteps") ?? 5;
    const apiRequests = [];
    const apiResponses = [];
    const generatedImageTags = [];
    const ephemeralContext = [];

    for (let step = 0; step <= maxSteps; step++) {
      const { textBuffer, toolCalls } = await this._collectModelEvents({
        chatModel,
        context: [...context, ...ephemeralContext],
        systemInstruction,
        toolDeclarations,
        stream,
        apiRequests,
        apiResponses,
      });

      if (toolCalls.length === 0) {
        return this._buildResult(textBuffer, generatedImageTags, {
          apiRequests,
          apiResponses,
        });
      }

      if (step === maxSteps) {
        logger.warn(
          { maxSteps },
          "Tool call loop reached maxSteps, forcing stop",
        );
        return this._buildResult(textBuffer, generatedImageTags, {
          apiRequests,
          apiResponses,
        });
      }

      if (!toolExecutor) {
        throw new Error("Tool calls require a toolExecutor.");
      }

      const results = await toolExecutor.executeAll(
        toolCalls,
        platform,
        channelRecord,
        aiService,
      );

      for (const tag of this.generatedImageTagPolicy.extractFromToolResults(
        results,
      )) {
        if (!generatedImageTags.includes(tag)) {
          generatedImageTags.push(tag);
        }
      }

      ephemeralContext.push({
        role: "tool_result",
        calls: toolCalls.map((toolCall, i) => ({
          ...toolCall,
          result: results[i],
        })),
      });

      logger.info(
        { step: step + 1, toolCount: toolCalls.length },
        "Executed tools, continuing loop",
      );
    }

    return {
      messages: [],
      emotionDelta: {},
      emotionReason: "",
      relationshipDelta: {},
      apiRequests,
      apiResponses,
    };
  }

  async _collectModelEvents({
    chatModel,
    context,
    systemInstruction,
    toolDeclarations,
    stream,
    apiRequests,
    apiResponses,
  }) {
    const toolCalls = [];
    let textBuffer = "";

    for await (const event of chatModel.generateChat(
      context,
      systemInstruction,
      toolDeclarations,
      { stream },
    )) {
      if (event.type === "text") {
        textBuffer += event.content;
      } else if (event.type === "tool_call") {
        toolCalls.push({
          id: event.id,
          name: event.name,
          args: event.args,
          _rawPart: event._rawPart,
        });
      } else if (event.type === "api_request") {
        apiRequests.push(event.data);
      } else if (event.type === "api_response") {
        apiResponses.push(event.data);
      }
    }

    return { textBuffer, toolCalls };
  }

  _buildResult(textBuffer, generatedImageTags, apiDetails) {
    return {
      ...this.generatedImageTagPolicy.appendMissingTags(
        this.responseParser.parse(textBuffer),
        generatedImageTags,
      ),
      ...apiDetails,
    };
  }
}
