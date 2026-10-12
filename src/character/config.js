import fs from "fs/promises";
import path from "path";
import { ConfigurationError } from "../config/ConfigurationError.js";

const CHARACTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @param {import('../config/ConfigManager.js').default} configManager
 * @returns {string}
 */
export function getRequiredCharacterId(configManager) {
  const characterId = configManager?.get("character");

  if (typeof characterId !== "string" || characterId.trim() === "") {
    throw new ConfigurationError("Missing required configuration: character");
  }

  const normalized = characterId.trim();
  if (!CHARACTER_ID_PATTERN.test(normalized)) {
    throw new ConfigurationError(
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

/**
 * @param {string} filePath
 * @returns {Promise<Object>}
 */
export async function loadRequiredCharacterConfig(filePath) {
  let config;
  try {
    config = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ConfigurationError(
        `Missing required character configuration: ${filePath}`,
      );
    }
    if (error instanceof SyntaxError) {
      throw new ConfigurationError(
        `Invalid JSON in character configuration: ${filePath}`,
      );
    }
    throw error;
  }

  return validateCharacterConfig(config, filePath);
}

/**
 * @param {Object} config
 * @param {string} [source]
 * @returns {Object}
 */
export function validateCharacterConfig(config, source = "character config") {
  const timeZone = config?.timezone;
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    throw new ConfigurationError(
      `Missing required character timezone in ${source}`,
    );
  }

  const normalizedTimeZone = timeZone.trim();
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: normalizedTimeZone,
    }).format();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new ConfigurationError(
      `Invalid character timezone in ${source}: ${normalizedTimeZone}`,
    );
  }

  return {
    ...config,
    timezone: normalizedTimeZone,
  };
}
