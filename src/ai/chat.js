import { generateText, stepCountIs } from "ai";
import { AIResponseParser } from "../chat/response/AIResponseParser.js";
import { GeneratedImageTagPolicy } from "../chat/response/GeneratedImageTagPolicy.js";
import { createLogger } from "../core/logger.js";
import { getAiSettings, getGenerationSettings } from "./config.js";
import { composeDialectTools } from "./dialects.js";
import { createLanguageModel } from "./models.js";
import {
  serializeMetadata,
  toRequestMetadata,
  toTextResultMetadata,
} from "./metadata.js";

const logger = createLogger("ChatAI");

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
  abortSignal,
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
    abortSignal,
    ...getGenerationSettings(settings),
  };
  const requestMetadata = toRequestMetadata({
    settings,
    system: request.system,
    messages,
    tools,
    appTools,
  });
  const apiRequests = [serializeMetadata(requestMetadata)];
  const result = await generateTextFn(request);
  const recoveredTextToolCall = await recoverTextToolCall(
    result,
    appTools,
    messages,
  );

  const toolResults = recoveredTextToolCall
    ? [recoveredTextToolCall.output]
    : collectToolOutputs(result);
  const generatedImageTags =
    generatedImageTagPolicy.extractFromToolResults(toolResults);
  const responseText = recoveredTextToolCall
    ? formatRecoveredToolResponse(recoveredTextToolCall.output)
    : result.text;
  const parsed = responseParser.parse(responseText);
  const responseMetadata = toTextResultMetadata(result);
  if (recoveredTextToolCall) {
    responseMetadata.recoveredTextToolCall = recoveredTextToolCall;
  }

  return {
    ...generatedImageTagPolicy.appendMissingTags(parsed, generatedImageTags),
    apiRequests,
    apiResponses: [serializeMetadata(responseMetadata)],
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

async function recoverTextToolCall(result, appTools, messages) {
  const hasNativeCall =
    result.toolCalls?.length ||
    (result.steps ?? []).some((step) => step.toolCalls?.length);
  if (hasNativeCall || typeof result.text !== "string") return null;

  let candidate = result.text.trim();
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) candidate = fenced[1].trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;

  try {
    const call = JSON.parse(candidate);
    const valid =
      call !== null &&
      typeof call === "object" &&
      !Array.isArray(call) &&
      typeof call.name === "string" &&
      call.name in appTools &&
      call.arguments !== null &&
      typeof call.arguments === "object" &&
      !Array.isArray(call.arguments);
    if (!valid) return null;

    logger.warn(
      { tool: call.name },
      "Model returned a tool call as text; executing the application tool directly",
    );
    const output = await appTools[call.name].execute(call.arguments, {
      messages,
    });
    return { toolName: call.name, input: call.arguments, output };
  } catch (_error) {
    return null;
  }
}

function formatRecoveredToolResponse(output) {
  if (typeof output?.error === "string" && output.error.trim()) {
    return `요청한 작업을 처리하지 못했어: ${output.error}`;
  }

  if (typeof output?.message === "string" && output.message.trim()) {
    return output.message;
  }

  return "요청한 작업을 처리했어.";
}
