export function toRequestMetadata({ settings, system, messages, tools }) {
  return {
    provider: settings.provider,
    model: settings.model,
    system,
    messages,
    tools: Object.keys(tools ?? {}),
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
