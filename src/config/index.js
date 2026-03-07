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
if (process.env.GEMINI_API_KEY) {
  configManager.setInMemory("secrets.geminiApiKey", process.env.GEMINI_API_KEY);
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

// Validate required configuration
const requiredFields = ["secrets.geminiApiKey"];
const missingFields = requiredFields.filter((field) => {
  return !configManager.has(field) || !configManager.get(field);
});

if (missingFields.length > 0) {
  throw new Error(
    `Missing required configuration: ${missingFields.join(", ")}. ` +
      `Please set them in your .env file.`,
  );
}

// Export the config manager instance
export { configManager };
export default configManager;
