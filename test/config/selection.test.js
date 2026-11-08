import test from "node:test";
import assert from "node:assert/strict";
import {
  readCharacterOption,
  selectedDefinitions,
} from "../../src/config/selection.js";
const definitions = [
  { id: "a", connections: { discord: {}, cli: {} } },
  { id: "b", connections: { discord: {} } },
];
test("host/deploy select every configured Discord character while CLI and explicit selection use the same list", () => {
  assert.deepEqual(
    selectedDefinitions(definitions, { platform: "discord" }).map(
      ({ id }) => id,
    ),
    ["a", "b"],
  );
  assert.deepEqual(
    selectedDefinitions(definitions, { platform: "cli" }).map(({ id }) => id),
    ["a"],
  );
  const characterId = readCharacterOption(["--character", "b"]);
  assert.deepEqual(
    selectedDefinitions(definitions, { platform: "discord", characterId }).map(
      ({ id }) => id,
    ),
    ["b"],
  );
  assert.throws(
    () => selectedDefinitions(definitions, { platform: "cli", characterId }),
    /No configured character/,
  );
  assert.throws(() => readCharacterOption(["--unsupported"]));
});
