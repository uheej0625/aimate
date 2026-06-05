import test from "node:test";
import assert from "node:assert";
import { toModelMessages } from "../../src/ai/chat.js";

test("toModelMessages converts app chat context to AI SDK model messages", () => {
  assert.deepStrictEqual(
    toModelMessages([
      { role: "user", content: "몇 시야?" },
      { role: "assistant", content: "잠깐만" },
      { role: "tool_result", content: "legacy value" },
    ]),
    [
      { role: "user", content: "몇 시야?" },
      { role: "assistant", content: "잠깐만" },
      { role: "user", content: "legacy value" },
    ],
  );
});
