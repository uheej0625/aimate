/**
 * Configuration management using ConfigManager
 *
 * Loads config from default.json and provides hot-reload support
 * Environment variables override file values
 *
 * Priority: Environment Variables > default.json
 */
import "./env.js";
import ConfigManager from "./ConfigManager.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize ConfigManager with default.json
const configPath = path.resolve(__dirname, "../../config/default.json");
const configManager = new ConfigManager(configPath);

const ACTIVE_AI_PURPOSES = ["chat", "image"];
const PROVIDER_LOADERS = {
  googleCloud: async () =>
    (await import("../providers/GoogleCloudProvider.js")).GoogleCloudProvider,
  openai: async () =>
    (await import("../providers/OpenAIProvider.js")).OpenAIProvider,
  vertex: async () =>
    (await import("../providers/VertexProvider.js")).VertexProvider,
};

// Override secrets only with environment variables (in memory, not saved to file)
if (process.env.DISCORD_TOKEN) {
  configManager.setInMemory("secrets.discordToken", process.env.DISCORD_TOKEN);
}
if (process.env.DISCORD_CLIENT_ID) {
  configManager.setInMemory(
    "secrets.discordClientId",
    process.env.DISCORD_CLIENT_ID,
  );
}
if (process.env.GOOGLE_CLOUD_API_KEY) {
  configManager.setInMemory(
    "secrets.googleCloudApiKey",
    process.env.GOOGLE_CLOUD_API_KEY,
  );
}
if (process.env.OPENAI_API_KEY) {
  configManager.setInMemory("secrets.openaiApiKey", process.env.OPENAI_API_KEY);
}
if (process.env.VERTEX_PROJECT_ID) {
  configManager.setInMemory(
    "secrets.vertexProjectId",
    process.env.VERTEX_PROJECT_ID,
  );
}
if (process.env.VERTEX_LOCATION) {
  configManager.setInMemory(
    "secrets.vertexLocation",
    process.env.VERTEX_LOCATION,
  );
}
if (process.env.VERTEX_CLIENT_EMAIL) {
  configManager.setInMemory(
    "secrets.vertexClientEmail",
    process.env.VERTEX_CLIENT_EMAIL,
  );
}
if (process.env.VERTEX_PRIVATE_KEY) {
  configManager.setInMemory(
    "secrets.vertexPrivateKey",
    process.env.VERTEX_PRIVATE_KEY,
  );
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
  manager = configManager,
  purposes = ACTIVE_AI_PURPOSES,
) {
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

// Export the config manager instance
export { configManager };
export default configManager;
