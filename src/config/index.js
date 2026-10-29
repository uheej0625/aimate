/**
 * Configuration helpers.
 *
 * Loads general settings from config/default.yaml. Credentials stay separate.
 *
 * Priority: Environment Variables > default.yaml
 */
import ConfigManager from "./ConfigManager.js";
import { ConfigurationError } from "./ConfigurationError.js";
import path from "path";
import { fileURLToPath } from "url";
import { validateAiPurpose } from "../ai/config.js";
import { loadAiCredentials } from "../ai/credentials.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACTIVE_AI_PURPOSES = ["chat", "image"];
const ENV_OVERRIDES = [
  ["VERTEX_PROJECT_ID", "ai.vertex.projectId"],
  ["VERTEX_LOCATION", "ai.vertex.location"],
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
  return path.resolve(__dirname, "../../config/default.yaml");
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
  return new ConfigManager(configPath, {
    watch,
    onLoad: (manager) => applyEnvOverrides(manager, env),
  });
}

/**
 * @param {ConfigManager} manager
 * @param {string[]} purposes
 * @returns {Promise<boolean>}
 */
export async function validateAiConfig(
  manager,
  purposes = ACTIVE_AI_PURPOSES,
  credentials = loadAiCredentials(),
) {
  if (!manager) {
    throw new Error("validateAiConfig requires a config manager.");
  }

  const missing = new Set();
  const invalid = [];

  for (const purpose of purposes) {
    const result = validateAiPurpose(manager, purpose, credentials);
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
          "Set general settings in config/default.yaml and credentials in the environment (.env for local development).",
      );
    }

    throw new ConfigurationError(messages.join(" "));
  }

  return true;
}

export { ConfigManager };
