import path from "path";

const CHARACTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @param {import('../config/ConfigManager.js').default} configManager
 * @returns {string}
 */
export function getRequiredCharacterId(configManager) {
  const characterId = configManager?.get("character");

  if (typeof characterId !== "string" || characterId.trim() === "") {
    throw new Error("Missing required configuration: character");
  }

  const normalized = characterId.trim();
  if (!CHARACTER_ID_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid character ID: ${normalized}. Use lowercase letters, numbers, and hyphens.`,
    );
  }

  return normalized;
}

/**
 * @param {import('../config/ConfigManager.js').default} configManager
 * @param {string} filename
 * @returns {string}
 */
export function resolveCharacterFile(configManager, filename) {
  return resolveCharacterFileById(getRequiredCharacterId(configManager), filename);
}

/**
 * @param {string} characterId
 * @param {string} filename
 * @returns {string}
 */
export function resolveCharacterFileById(characterId, filename) {
  if (!CHARACTER_ID_PATTERN.test(characterId)) {
    throw new Error(
      `Invalid character ID: ${characterId}. Use lowercase letters, numbers, and hyphens.`,
    );
  }

  return path.join(
    process.cwd(),
    "content",
    "characters",
    characterId,
    filename,
  );
}
