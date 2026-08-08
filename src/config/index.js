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
import { validateAiPurpose } from "../ai/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACTIVE_AI_PURPOSES = ["chat", "image"];
const ENV_OVERRIDES = [
  ["GOOGLE_GENERATIVE_AI_API_KEY", "secrets.googleApiKey"],
  ["OPENAI_API_KEY", "secrets.openaiApiKey"],
  ["AI_GATEWAY_API_KEY", "secrets.aiGatewayApiKey"],
  ["OPENAI_COMPATIBLE_API_KEY", "secrets.openaiCompatibleApiKey"],
  ["XAI_API_KEY", "secrets.xaiApiKey"],
  ["VERTEX_PROJECT_ID", "secrets.vertexProjectId"],
  ["VERTEX_LOCATION", "secrets.vertexLocation"],
  ["VERTEX_CLIENT_EMAIL", "secrets.vertexClientEmail"],
  ["VERTEX_PRIVATE_KEY", "secrets.vertexPrivateKey"],
];

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
 * @param {ConfigManager} manager
 * @param {string[]} purposes
 * @returns {Promise<boolean>}
 */
export async function validateAiConfig(manager, purposes = ACTIVE_AI_PURPOSES) {
  if (!manager) {
    throw new Error("validateAiConfig requires a config manager.");
  }

  const missing = new Set();
  const invalid = [];

  for (const purpose of purposes) {
    const result = validateAiPurpose(manager, purpose);
    for (const field of result.missing) missing.add(field);
    invalid.push(...result.invalid);
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
