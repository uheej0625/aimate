import { ConfigurationError } from "../../config/ConfigurationError.js";

export function getDecisionSettings(configManager) {
  return {
    debounceMs: 1000,
    maxWaitMs: 5000,
    recheckMs: 5000,
    maxContextMessages: 20,
    maxContextTokens: 4000,
    character: "",
    rules: "",
    ...configManager.get("conversation.decision"),
  };
}

export function validateConversationConfig(configManager, credentials) {
  const mode = configManager.get("conversation.responseMode") ?? "buffer";
  if (!["buffer", "decision"].includes(mode))
    throw new ConfigurationError(
      "conversation.responseMode must be buffer or decision.",
    );
  if (mode === "buffer") return;
  const settings = getDecisionSettings(configManager);
  for (const key of [
    "debounceMs",
    "maxWaitMs",
    "recheckMs",
    "maxContextMessages",
    "maxContextTokens",
  ]) {
    if (!Number.isSafeInteger(settings[key]) || settings[key] <= 0)
      throw new ConfigurationError(
        `conversation.decision.${key} must be a positive integer.`,
      );
  }
  if (
    settings.maxWaitMs < settings.debounceMs ||
    settings.maxContextTokens < 512
  )
    throw new ConfigurationError(
      "Decision maxWaitMs must be >= debounceMs and maxContextTokens must be >= 512.",
    );
  for (const key of ["character", "rules"])
    if (typeof settings[key] !== "string" || settings[key].length > 2000)
      throw new ConfigurationError(
        `conversation.decision.${key} must be a string of at most 2000 characters.`,
      );
  const ai = configManager.get("ai.decision");
  if (ai?.provider !== "gateway")
    throw new ConfigurationError(
      "ai.decision.provider must be gateway; other Decision providers are not supported.",
    );
  if (
    typeof ai.prompt !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(ai.prompt)
  )
    throw new ConfigurationError(
      "ai.decision.prompt must be a prompt pack name.",
    );
  if (!ai?.model || typeof ai.model !== "string")
    throw new ConfigurationError(
      "ai.decision.model is required in decision mode.",
    );
  if (!Number.isSafeInteger(ai.timeoutMs) || ai.timeoutMs <= 0)
    throw new ConfigurationError(
      "ai.decision.timeoutMs must be a positive integer.",
    );
  if (ai.apiKey)
    throw new ConfigurationError(
      "ai.decision.apiKey is not supported; use environment credentials.",
    );
  if (!credentials.aiGatewayApiKey)
    throw new ConfigurationError(
      "Decision mode requires AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN. Use conversation.responseMode: buffer without a Decision API.",
    );
}
