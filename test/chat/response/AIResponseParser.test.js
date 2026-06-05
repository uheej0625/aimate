import test from "node:test";
import assert from "node:assert";
import { AIResponseParser } from "../../../src/chat/response/AIResponseParser.js";

test("AIResponseParser parses markdown response sections", () => {
  const parser = new AIResponseParser();
  const result = parser.parse(`
## messages
Hello! [BREAK] How are you?
## emotion_delta
happiness: 5
## emotion_reason
Greeting
## relationship_delta
trust: 2
`);

  assert.deepStrictEqual(result.messages, ["Hello!", "How are you?"]);
  assert.deepStrictEqual(result.emotionDelta, { happiness: 5 });
  assert.strictEqual(result.emotionReason, "Greeting");
  assert.deepStrictEqual(result.relationshipDelta, { trust: 2 });
});

test("AIResponseParser uses raw text as a fallback message", () => {
  const parser = new AIResponseParser();
  const result = parser.parse("plain response");

  assert.deepStrictEqual(result.messages, ["plain response"]);
  assert.deepStrictEqual(result.emotionDelta, {});
  assert.deepStrictEqual(result.relationshipDelta, {});
});
