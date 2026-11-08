import { parseArgs } from "node:util";
import { ConfigurationError } from "./ConfigurationError.js";

export function selectedDefinitions(
  definitions,
  { platform, characterId } = {},
) {
  const selected = definitions.filter(
    (entry) =>
      (!platform || entry.connections[platform]) &&
      (!characterId || entry.id === characterId),
  );
  if (!selected.length)
    throw new ConfigurationError(
      "No configured character matches the requested platform/character.",
    );
  return selected;
}

export function readCharacterOption(args = process.argv.slice(2)) {
  return parseArgs({ args, options: { character: { type: "string" } } }).values
    .character;
}
