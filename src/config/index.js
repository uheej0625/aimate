/**
 * Configuration helpers.
 *
 * Loads config/default.json and applies environment variable overrides.
 *
 * Priority: Environment Variables > default.json
 */
import ConfigManager from "./ConfigManager.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACTIVE_AI_PURPOSES = ["chat", "image"];
const ENV_OVERRIDES = [
  ["DISCORD_TOKEN", "secrets.discordToken"],
  ["DISCORD_CLIENT_ID", "secrets.discordClientId"],
  ["GOOGLE_CLOUD_API_KEY", "secrets.googleCloudApiKey"],
  ["OPENAI_API_KEY", "secrets.openaiApiKey"],
  ["AI_GATEWAY_API_KEY", "secrets.aiGatewayApiKey"],
  [
    "AI_SDK_OPENAI_COMPATIBLE_API_KEY",
    "secrets.aiSdkOpenAICompatibleApiKey",
  ],
  ["VERTEX_PROJECT_ID", "secrets.vertexProjectId"],
  ["VERTEX_LOCATION", "secrets.vertexLocation"],
  ["VERTEX_CLIENT_EMAIL", "secrets.vertexClientEmail"],
  ["VERTEX_PRIVATE_KEY", "secrets.vertexPrivateKey"],
];

const PROVIDER_LOADERS = {
  aiSdk: async () =>
    (await import("../providers/AISDKProvider.js")).AISDKProvider,
  googleCloud: async () =>
    (await import("../providers/GoogleCloudProvider.js")).GoogleCloudProvider,
  openai: async () =>
    (await import("../providers/OpenAIProvider.js")).OpenAIProvider,
  vertex: async () =>
    (await import("../providers/VertexProvider.js")).VertexProvider,
};

function isTestRuntime() {
  return (
    process.env.NODE_ENV === "test" ||
    process.argv.some((arg) => arg.includes("--test")) ||
    process.execArgv.some((arg) => arg.includes("--test")) ||
    !!process.env.NODE_TEST_CONTEXT
  );
}

export function getDefaultConfigPath() {
  return path.resolve(__dirname, "../../config/default.json");
}

export function applyEnvOverrides(manager, env = process.env) {
  for (const [envKey, configPath] of ENV_OVERRIDES) {
    if (env[envKey]) {
      manager.setInMemory(configPath, env[envKey]);
    }
  }

  return manager;
}

export function createConfigManager({
  configPath = getDefaultConfigPath(),
  env = process.env,
  watch = !isTestRuntime(),
} = {}) {
  const manager = new ConfigManager(configPath, { watch });
  return applyEnvOverrides(manager, env);
}

/**
 * Validate only the providers that are instantiated by the app.
 *
 * Provider modules are loaded lazily here to avoid a config -> provider -> logger
 * import cycle during module initialization.
 *
 * @param {ConfigManager} manager
 * @param {string[]} purposes
 * @returns {Promise<boolean>}
 */
export async function validateActiveProviders(
  manager,
  purposes = ACTIVE_AI_PURPOSES,
) {
  if (!manager) {
    throw new Error("validateActiveProviders requires a config manager.");
  }

  const missing = new Set();
  const invalid = [];
  const providerCache = new Map();
  const allowedProviders = Object.keys(PROVIDER_LOADERS);

  for (const purpose of purposes) {
    const settingsPath = `ai.${purpose}`;
    const settings = manager.get(settingsPath);

    if (!settings) {
      invalid.push(`${settingsPath} 설정이 없습니다.`);
      continue;
    }

    const provider = settings.provider;
    if (!provider) {
      missing.add(`${settingsPath}.provider`);
      continue;
    }

    const loadProvider = PROVIDER_LOADERS[provider];
    if (!loadProvider) {
      invalid.push(
        `${settingsPath}.provider="${provider}" (허용값: ${allowedProviders.join(", ")})`,
      );
      continue;
    }

    let ProviderClass = providerCache.get(provider);
    if (!ProviderClass) {
      ProviderClass = await loadProvider();
      providerCache.set(provider, ProviderClass);
    }

    if (typeof ProviderClass.validateConfig === "function") {
      for (const field of ProviderClass.validateConfig(manager, purpose)) {
        missing.add(field);
      }
    }
  }

  if (invalid.length > 0 || missing.size > 0) {
    const messages = [];

    if (invalid.length > 0) {
      messages.push(`Invalid provider configuration: ${invalid.join(", ")}`);
    }

    if (missing.size > 0) {
      messages.push(
        `Missing required configuration: ${[...missing].join(", ")}. ` +
          "Please set them in your .env file or config/default.json.",
      );
    }

    throw new Error(messages.join(" "));
  }

  return true;
}

export { ConfigManager };
