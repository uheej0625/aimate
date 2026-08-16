import {
  hasEnabledNativeTools,
  resolveDialect,
  supportedAiDialects,
  validateNativeTools,
} from "./dialects.js";

const SUPPORTED_PROVIDERS = [
  "gateway",
  "openai",
  "google",
  "vertex",
  "openaiCompatible",
  "xai",
];

function valueExists(value) {
  return value !== undefined && value !== null && value !== "";
}

export function getAiSettings(configManager, purpose) {
  const settings = configManager.get(`ai.${purpose}`);

  if (!settings) {
    throw new Error(`Missing ai.${purpose} configuration.`);
  }

  return {
    provider: "gateway",
    providerOptions: undefined,
    dialect: undefined,
    api: undefined,
    nativeTools: undefined,
    maxRetries: undefined,
    ...settings,
  };
}

export function getProviderOptions(settings) {
  return settings.providerOptions ?? undefined;
}

export function getGenerationSettings(settings) {
  return stripEmpty({
    temperature: settings.temperature,
    maxOutputTokens: settings.maxOutputTokens,
    topP: settings.topP,
    topK: settings.topK,
    maxRetries: settings.maxRetries,
    providerOptions: getProviderOptions(settings),
  });
}

export function stripEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => valueExists(value)),
  );
}

export function validateAiPurpose(configManager, purpose) {
  const missing = [];
  const invalid = [];
  const settings = configManager.get(`ai.${purpose}`);

  if (!settings) {
    invalid.push(`ai.${purpose} 설정이 없습니다.`);
    return { missing, invalid };
  }

  if (!settings.model) {
    missing.push(`ai.${purpose}.model`);
  }
  if (!settings.prompt) {
    missing.push(`ai.${purpose}.prompt`);
  }

  const provider = settings.provider ?? "gateway";
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    invalid.push(
      `ai.${purpose}.provider="${provider}" (허용값: ${SUPPORTED_PROVIDERS.join(", ")})`,
    );
    return { missing, invalid };
  }

  if (provider === "gateway") {
    const hasGatewayAuth =
      configManager.get("secrets.aiGatewayApiKey") ||
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN;
    if (!hasGatewayAuth)
      missing.push("AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN");
  }

  if (provider === "openai" && !configManager.get("secrets.openaiApiKey")) {
    missing.push("OPENAI_API_KEY");
  }

  if (provider === "google" && !configManager.get("secrets.googleApiKey")) {
    missing.push("GOOGLE_GENERATIVE_AI_API_KEY");
  }

  if (provider === "vertex") {
    if (!configManager.get("secrets.vertexProjectId")) {
      missing.push("VERTEX_PROJECT_ID");
    }
    if (!configManager.get("secrets.vertexLocation")) {
      missing.push("VERTEX_LOCATION");
    }
  }

  if (provider === "openaiCompatible") {
    if (!settings.baseURL) missing.push(`ai.${purpose}.baseURL`);
    if (
      !settings.apiKey &&
      !configManager.get("secrets.openaiCompatibleApiKey")
    ) {
      missing.push("OPENAI_COMPATIBLE_API_KEY");
    }
  }

  if (provider === "xai" && !configManager.get("secrets.xaiApiKey")) {
    missing.push("XAI_API_KEY");
  }

  if (settings.api && provider !== "xai") {
    invalid.push(`ai.${purpose}.api는 xai provider에서만 사용할 수 있습니다.`);
  }

  if (provider === "xai") {
    const api = settings.api ?? "chat";
    if (!["chat", "responses"].includes(api)) {
      invalid.push(`ai.${purpose}.api="${api}" (허용값: chat, responses)`);
    }
    if (hasEnabledNativeTools(settings) && api !== "responses") {
      invalid.push(
        `ai.${purpose}.nativeTools는 xai Responses API (api: "responses")가 필요합니다.`,
      );
    }
  }

  if (settings.dialect && !supportedAiDialects().includes(settings.dialect)) {
    invalid.push(
      `ai.${purpose}.dialect="${settings.dialect}" (허용값: ${supportedAiDialects().join(", ")})`,
    );
  }

  invalid.push(
    ...validateNativeTools(settings).map(
      (message) => `ai.${purpose}.${message}`,
    ),
  );

  if (hasEnabledNativeTools(settings)) {
    const dialect = resolveDialect(settings);

    if (!dialect) {
      invalid.push(`ai.${purpose}.nativeTools에는 dialect가 필요합니다.`);
    } else if (!supportedAiDialects().includes(dialect)) {
      invalid.push(
        `ai.${purpose}.nativeTools에 대한 dialect="${dialect}"은 지원되지 않습니다.`,
      );
    }
  }

  return { missing, invalid };
}

export function supportedAiProviders() {
  return [...SUPPORTED_PROVIDERS];
}
