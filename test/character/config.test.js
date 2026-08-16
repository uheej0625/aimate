import test from "node:test";
import assert from "node:assert";
import path from "path";
import {
  getRequiredCharacterId,
  resolveCharacterFile,
  resolveCharacterFileById,
} from "../../src/character/config.js";

function createConfigManager(character) {
  return {
    get: (key) => (key === "character" ? character : undefined),
  };
}

test("character config resolves files from the selected character directory", () => {
  const configManager = createConfigManager("alice-v2");

  assert.strictEqual(getRequiredCharacterId(configManager), "alice-v2");
  assert.strictEqual(
    resolveCharacterFile(configManager, "identity.md"),
    path.join(
      process.cwd(),
      "content",
      "characters",
      "alice-v2",
      "identity.md",
    ),
  );
  assert.strictEqual(
    resolveCharacterFileById("alice-v2", "reference.png"),
    path.join(
      process.cwd(),
      "content",
      "characters",
      "alice-v2",
      "reference.png",
    ),
  );
});

test("character config rejects missing or invalid character IDs", () => {
  assert.throws(
    () => getRequiredCharacterId(createConfigManager("")),
    /Missing required configuration: character/,
  );
  assert.throws(
    () => getRequiredCharacterId(createConfigManager("Alice")),
    /Invalid character ID: Alice/,
  );
});
