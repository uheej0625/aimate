import test from "node:test";
import assert from "node:assert";
import { AIResponseParser } from "../../../src/chat/response/AIResponseParser.js";

test("AIResponseParser parses markdown response sections", () => {
  const parser = new AIResponseParser();
  const result = parser.parse(`
## messages
Hello! [BREAK] How are you?
`);

  assert.deepStrictEqual(result.messages, ["Hello!", "How are you?"]);
});

test("AIResponseParser uses raw text as a fallback message", () => {
  const parser = new AIResponseParser();
  const result = parser.parse("plain response");

  assert.deepStrictEqual(result.messages, ["plain response"]);
});

test("AIResponseParser splits raw text with break markers", () => {
  const parser = new AIResponseParser();
  const result = parser.parse("first [BREAK] second");

  assert.deepStrictEqual(result.messages, ["first", "second"]);
});
