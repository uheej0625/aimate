const SUPPORTED_PROVIDERS = [
  "gateway",
  "openai",
  "google",
  "vertex",
  "openaiCompatible",
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
    if (!hasGatewayAuth) missing.push("AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN");
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

  return { missing, invalid };
}

export function supportedAiProviders() {
  return [...SUPPORTED_PROVIDERS];
}
