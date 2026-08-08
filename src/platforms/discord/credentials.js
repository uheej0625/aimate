import { getRequiredCharacterId } from "../../character/config.js";

/**
 * @param {string} characterId
 * @returns {string}
 */
export function getDiscordTokenEnvKey(characterId) {
  return `DISCORD_${characterId.toUpperCase().replaceAll("-", "_")}_TOKEN`;
}

/**
 * @param {import('../../config/ConfigManager.js').default} configManager
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function getRequiredDiscordToken(configManager, env = process.env) {
  const characterId = getRequiredCharacterId(configManager);
  const envKey = getDiscordTokenEnvKey(characterId);
  const token = env[envKey]?.trim();

  if (!token) {
    throw new Error(`Missing required environment variable: ${envKey}`);
  }

  return token;
}
