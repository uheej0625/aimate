import { resolveDialect } from "./dialects.js";

export function toRequestMetadata({
  settings,
  system,
  messages,
  tools,
  appTools,
}) {
  return {
    provider: settings.provider,
    dialect: resolveDialect(settings),
    api: settings.api,
    model: settings.model,
    system,
    messages,
    tools: Object.keys(tools ?? {}),
    appTools: Object.keys(appTools ?? {}),
    nativeTools: Object.keys(tools ?? {}).filter(
      (name) => !(name in (appTools ?? {})),
    ),
    temperature: settings.temperature,
    maxOutputTokens: settings.maxOutputTokens,
    topP: settings.topP,
    topK: settings.topK,
    maxRetries: settings.maxRetries,
    providerOptions: settings.providerOptions,
  };
}

export function toTextResultMetadata(result) {
  return {
    finishReason: result.finishReason,
    usage: result.usage,
    totalUsage: result.totalUsage,
    warnings: result.warnings,
    request: result.request,
    response: result.response,
    providerMetadata: result.providerMetadata,
    steps: result.steps?.map(toStepMetadata) ?? [],
  };
}

export function toStepMetadata(step) {
  return {
    stepNumber: step.stepNumber,
    model: step.model,
    finishReason: step.finishReason,
    usage: step.usage,
    warnings: step.warnings,
    request: step.request,
    response: step.response,
    toolCalls: step.toolCalls,
    toolResults: step.toolResults,
    providerMetadata: step.providerMetadata,
  };
}

export function serializeMetadata(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return "[unserializable]";
  }
}
