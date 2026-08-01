import { generateText, stepCountIs } from "ai";
import { AIResponseParser } from "../chat/response/AIResponseParser.js";
import { GeneratedImageTagPolicy } from "../chat/response/GeneratedImageTagPolicy.js";
import { getAiSettings, getGenerationSettings } from "./config.js";
import { composeDialectTools } from "./dialects.js";
import { createLanguageModel } from "./models.js";
import {
  serializeMetadata,
  toRequestMetadata,
  toTextResultMetadata,
} from "./metadata.js";

export async function generateChatReply({
  configManager,
  context,
  systemInstruction,
  platform,
  channelRecord,
  toolRegistry,
  toolContext,
  responseParser = new AIResponseParser(),
  generatedImageTagPolicy = new GeneratedImageTagPolicy(),
  generateTextFn = generateText,
  createLanguageModelFn = createLanguageModel,
}) {
  if (context.length === 0) {
    return {
      messages: ["..."],
      apiRequests: [],
      apiResponses: [],
    };
  }

  const settings = getAiSettings(configManager, "chat");
  const model = createLanguageModelFn(configManager, "chat");
  const messages = toModelMessages(context);
  const appTools = toolRegistry?.createToolSet(platform, toolContext) ?? {};
  const tools = composeDialectTools({ settings, appTools });
  const request = {
    model,
    system: systemInstruction || undefined,
    messages,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    stopWhen: stepCountIs(configManager.get("tools.maxSteps") ?? 5),
    ...getGenerationSettings(settings),
  };
  const apiRequests = [
    serializeMetadata(
      toRequestMetadata({
        settings,
        system: request.system,
        messages,
        tools,
        appTools,
      }),
    ),
  ];

  const result = await generateTextFn(request);
  const toolResults = collectToolOutputs(result);
  const generatedImageTags =
    generatedImageTagPolicy.extractFromToolResults(toolResults);
  const parsed = responseParser.parse(result.text);

  return {
    ...generatedImageTagPolicy.appendMissingTags(parsed, generatedImageTags),
    apiRequests,
    apiResponses: [serializeMetadata(toTextResultMetadata(result))],
  };
}

export function toModelMessages(context = []) {
  return context.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content ?? "",
  }));
}

function collectToolOutputs(result) {
  if (result.steps?.length) {
    return result.steps.flatMap((step) =>
      (step.toolResults ?? []).map((toolResult) => toolResult.output),
    );
  }

  return (result.toolResults ?? []).map((toolResult) => toolResult.output);
}
