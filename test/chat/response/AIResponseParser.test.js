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

test("AIResponseParser accepts silent responses without leaking other sections", () => {
  const parser = new AIResponseParser();
  for (const text of [
    "",
    " \n\t",
    "## messages",
    "## messages\n",
    "# response\n\n## messages",
    "## messages\n## state\ninternal",
    "## messages\n\n## state\ninternal",
    "# response\r\n\r\n## messages \t\r\n\r\n## state\r\ninternal",
    "## messages\n [BREAK] \n## state\ninternal",
  ]) {
    assert.deepStrictEqual(
      parser.parse(text).messages,
      [],
      JSON.stringify(text),
    );
  }
});

test("AIResponseParser keeps multiline messages and excludes later sections", () => {
  const parser = new AIResponseParser();
  assert.deepStrictEqual(
    parser.parse(
      "# response\n## messages\nfirst\nsecond [BREAK] third\n## state\ninternal",
    ).messages,
    ["first\nsecond", "third"],
  );
});
