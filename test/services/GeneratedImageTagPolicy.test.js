import test from "node:test";
import assert from "node:assert";
import { GeneratedImageTagPolicy } from "../../src/services/GeneratedImageTagPolicy.js";

test("GeneratedImageTagPolicy extracts image tags from tool results", () => {
  const policy = new GeneratedImageTagPolicy();
  const tags = policy.extractFromToolResults([
    { imageId: "9a9d426d" },
    {
      instruction: "Show [IMAGE:9a9d426d] and [IMAGE:21dc101b.png].",
    },
    { error: "ignored" },
  ]);

  assert.deepStrictEqual(tags, ["[IMAGE:9a9d426d]", "[IMAGE:21dc101b]"]);
});

test("GeneratedImageTagPolicy appends missing tags to final message", () => {
  const policy = new GeneratedImageTagPolicy();
  const result = policy.appendMissingTags(
    {
      messages: ["done"],
      emotionDelta: {},
      emotionReason: "",
      relationshipDelta: {},
    },
    ["[IMAGE:9a9d426d]"],
  );

  assert.deepStrictEqual(result.messages, ["done\n[IMAGE:9a9d426d]"]);
});
