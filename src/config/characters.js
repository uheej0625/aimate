import { getRequiredCharacterId } from "../character/config.js";
import { ConfigurationError } from "./ConfigurationError.js";

const RUNTIME_SETTINGS = new Set([
  "ai",
  "conversation",
  "messages",
  "humanize",
  "features",
  "tools",
]);
const isMapping = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The host and platform entrypoints share this character/connection list. */
export function getCharacterDefinitions(configManager) {
  const definitions = configManager.get("characters");
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new ConfigurationError("characters must be a non-empty list.");
  }
  const ids = new Set();
  return definitions.map((definition) => {
    if (
      !isMapping(definition) ||
      Object.keys(definition).some(
        (key) => !["id", "connections", "settings"].includes(key),
      )
    ) {
      throw new ConfigurationError(
        "Character entries support id, connections and settings only.",
      );
    }
    const id = getRequiredCharacterId({ get: () => definition.id });
    if (ids.has(id))
      throw new ConfigurationError(`Duplicate character ID: ${id}`);
    ids.add(id);
    const { connections, settings = {} } = definition;
    if (
      !isMapping(connections) ||
      Object.keys(connections).length === 0 ||
      Object.entries(connections).some(
        ([platform, options]) =>
          !["discord", "cli"].includes(platform) ||
          !isMapping(options) ||
          Object.keys(options).length !== 0,
      )
    ) {
      throw new ConfigurationError(
        `Character ${id} requires discord/cli connection mappings with empty options.`,
      );
    }
    if (
      !isMapping(settings) ||
      Object.keys(settings).some((key) => !RUNTIME_SETTINGS.has(key))
    ) {
      throw new ConfigurationError(
        `Character ${id} settings support ai, conversation, messages, humanize, features and tools only.`,
      );
    }
    return structuredClone({ id, connections, settings });
  });
}

/** Merge mappings; arrays and explicit nulls replace their defaults. */
export function mergeCharacterSettings(defaults, settings) {
  return Object.fromEntries(
    Object.keys({ ...defaults, ...settings }).map((key) => [
      key,
      Object.hasOwn(settings, key)
        ? isMapping(defaults[key]) && isMapping(settings[key])
          ? mergeCharacterSettings(defaults[key], settings[key])
          : structuredClone(settings[key])
        : structuredClone(defaults[key]),
    ]),
  );
}
