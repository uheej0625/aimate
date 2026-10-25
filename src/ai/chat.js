import { generateText, stepCountIs } from "ai";
import { AIResponseParser } from "../chat/response/AIResponseParser.js";
import { GeneratedImageTagPolicy } from "../chat/response/GeneratedImageTagPolicy.js";
import { createLogger, elapsedMs } from "../core/logger.js";
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
    logger.debug(
      { event: "model.skipped", reason: "empty_context" },
      "Chat model skipped",
    );
    return {
      messages: [],
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
    onStepFinish: (step) => {
      logger.debug(
        {
          event: "model.step.completed",
          stepNumber: step.stepNumber,
          finishReason: step.finishReason,
          ...summarizeUsage(step.usage),
          toolCallCount: step.toolCalls?.length ?? 0,
          warningCount: step.warnings?.length ?? 0,
        },
        "Chat model step completed",
      );
    },
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
  const startedAt = performance.now();
  const modelFields = { provider: settings.provider, model: settings.model };
  logger.info(
    {
      ...modelFields,
      event: "model.started",
      purpose: "chat",
      contextMessageCount: messages.length,
      toolCount: Object.keys(tools).length,
      maxSteps: configManager.get("tools.maxSteps") ?? 5,
      maxRetries: settings.maxRetries,
    },
    "Chat model started",
  );
  let result;
  try {
    result = await generateTextFn(request);
  } catch (error) {
    const cancelled = abortSignal?.aborted || error.name === "AbortError";
    logger[cancelled ? "debug" : "warn"](
      {
        ...modelFields,
        event: cancelled ? "model.cancelled" : "model.failed",
        purpose: "chat",
        errorType: error.name,
        statusCode: error.statusCode ?? error.lastError?.statusCode,
        durationMs: elapsedMs(startedAt),
      },
      "Chat model ended without a result",
    );
    throw error;
  }
  logger.info(
    {
      ...modelFields,
      event: "model.completed",
      purpose: "chat",
      durationMs: elapsedMs(startedAt),
      finishReason: result.finishReason,
      stepCount: result.steps?.length ?? 1,
      ...summarizeUsage(result.totalUsage ?? result.usage),
      toolCallCount: (result.steps ?? [result]).reduce(
        (count, step) => count + (step.toolCalls?.length ?? 0),
        0,
      ),
    },
    "Chat model completed",
  );
  const warningCount = result.steps?.length
    ? result.steps.reduce(
        (count, step) => count + (step.warnings?.length ?? 0),
        0,
      )
    : (result.warnings?.length ?? 0);
  if (warningCount)
    logger.warn(
      { ...modelFields, event: "model.warnings", warningCount },
      "Chat model returned warnings",
    );
  const recoveredTextToolCall = await recoverTextToolCall(
    result,
    appTools,
    messages,
    abortSignal,
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

export function summarizeUsage(usage) {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
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

async function recoverTextToolCall(result, appTools, messages, abortSignal) {
  const hasNativeCall =
    result.toolCalls?.length ||
    (result.steps ?? []).some((step) => step.toolCalls?.length);
  if (hasNativeCall || typeof result.text !== "string") return null;

  let candidate = result.text.trim();
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) candidate = fenced[1].trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;

  let toolName;
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
    toolName = call.name;

    logger.warn(
      { event: "model.tool_call.recovered", toolName: call.name },
      "Model returned a tool call as text; executing the application tool directly",
    );
    if (abortSignal?.aborted) return null;
    const output = await appTools[call.name].execute(call.arguments, {
      messages,
      abortSignal,
    });
    if (abortSignal?.aborted) return null;
    return { toolName: call.name, input: call.arguments, output };
  } catch (error) {
    if (toolName)
      logger.warn(
        { event: "model.tool_call.recovery_failed", toolName, err: error },
        "Text tool call recovery failed",
      );
    return null;
  }
}

function formatRecoveredToolResponse(output) {
  if (output?.success && ["reply", "react"].includes(output.action)) return "";
  if (typeof output?.error === "string" && output.error.trim()) {
    return `요청한 작업을 처리하지 못했어: ${output.error}`;
  }

  if (typeof output?.message === "string" && output.message.trim()) {
    return output.message;
  }

  return "요청한 작업을 처리했어.";
}
