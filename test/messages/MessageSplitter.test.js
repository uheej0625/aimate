import test from "node:test";
import assert from "node:assert/strict";
import { MessageSplitter } from "../../src/messages/MessageSplitter.js";

const splitter = new MessageSplitter();
const visible = (text) => text.replace(/\[IMAGE:(.*?)\]/g, "");

test("short text and exact limit are unchanged", () => {
  for (const text of ["", "  hello  ", "x".repeat(32)]) {
    assert.deepEqual(splitter.split(text, 32), [text]);
  }
});

test("paragraph, line, sentence and whitespace boundaries have priority in that order", () => {
  const cases = [
    ["first paragraph\n\nsecond line\n" + "x".repeat(30), "first paragraph"],
    ["first line\nSecond sentence. " + "x".repeat(30), "first line"],
    ["First sentence. extra words " + "x".repeat(30), "First sentence."],
    ["first words " + "x".repeat(40), "first words"],
  ];
  for (const [input, first] of cases) {
    const output = splitter.split(input, 32);
    assert.equal(output[0], first);
    assert.ok(output.every((text) => visible(text).length <= 32));
  }
});

test("unbroken text splits without content loss or broken surrogate pairs", () => {
  for (const input of [
    "x".repeat(101),
    "😀".repeat(50),
    "a" + "😀".repeat(50),
  ]) {
    const output = splitter.split(input, 33);
    assert.equal(output.join(""), input);
    assert.ok(output.every((text) => text.length <= 33 && text.isWellFormed()));
  }
});

test("image tags remain atomic and stay on the last chunk when appended there", () => {
  const tag = "[IMAGE:1234abcd]";
  const input = "x".repeat(70) + "\n" + tag;
  const output = splitter.split(input, 32);
  assert.ok(output.at(-1).endsWith(tag));
  assert.equal(output.filter((text) => text.includes(tag)).length, 1);
  assert.equal(output.join(""), input);
  assert.ok(output.every((text) => visible(text).length <= 32));
});

test("tag contents cannot become split boundaries, even for oversized invalid tags", () => {
  const tag = `[IMAGE:${"word. ".repeat(20)}]`;
  const input = "a".repeat(30) + tag + "b".repeat(40);
  const output = splitter.split(input, 32);
  assert.equal(output.join(""), input);
  assert.equal(output.filter((text) => text.includes(tag)).length, 1);
  assert.ok(output.every((text) => visible(text).length <= 32));
});

test("a code block that fits remains a single unchanged block among long prose", () => {
  const block = "```js\nconst n = 1;\n```";
  const output = splitter.split(
    "a".repeat(40) + "\n" + block + "\n" + "b".repeat(40),
    32,
  );
  assert.equal(output.filter((text) => text.includes(block)).length, 1);
  assert.ok(output.every((text) => text.length <= 32));
});

test("oversized code blocks keep their language, body and balanced fences", () => {
  for (const fence of ["```", "````", "~~~"]) {
    const opening = `${fence}js\n`;
    const body = "const a = 1;\n" + "x".repeat(90) + "\n  last();\n";
    const output = splitter.split(opening + body + fence, 40);
    assert.ok(output.length > 1);
    for (const chunk of output) {
      assert.ok(chunk.length <= 40);
      assert.ok(chunk.startsWith(opening));
      assert.ok(chunk.endsWith(`\n${fence}`));
    }
    assert.equal(
      output
        .map((chunk) => chunk.slice(opening.length, -(fence.length + 1)))
        .join(""),
      body,
    );
  }
});

test("small code fragments are separate bubbles so fences cannot run together", () => {
  const body = "a\n" + "x".repeat(35);
  const output = splitter.split("```\n" + body + "\n```", 40);
  assert.equal(output.length, 3);
  assert.ok(
    output.every(
      (chunk) => chunk.startsWith("```\n") && chunk.endsWith("\n```"),
    ),
  );
});

test("unclosed long code blocks get closed on each bubble", () => {
  const output = splitter.split("```js\n" + "x".repeat(100), 40);
  assert.ok(
    output.every((chunk) => chunk.length <= 40 && chunk.endsWith("\n```")),
  );
});

test("oversized code fence metadata does not consume the entire message budget", () => {
  const output = splitter.split(
    "```" + "language".repeat(30) + "\n" + "x".repeat(70) + "\n```",
    32,
  );
  assert.ok(
    output.every((chunk) => chunk.length <= 32 && chunk.startsWith("```\n")),
  );
});

test("invalid limits are rejected instead of producing unsafe or non-progressing splits", () => {
  for (const limit of [0, -1, 31, 2001, 32.5, NaN, "1900", Infinity]) {
    assert.throws(() => splitter.split("hello", limit), RangeError);
  }
});

test("CRLF blocks and nested shorter fences preserve the complete code body", () => {
  const fence = "````";
  const opening = `${fence}markdown\r\n`;
  const body = "```js\r\n" + "x".repeat(100) + "\r\n```\r\n";
  const output = splitter.split(opening + body + fence, 40);
  assert.ok(
    output.every((text) => text.length <= 40 && text.startsWith(opening)),
  );
  assert.equal(
    output
      .map((text) => text.slice(opening.length, -(fence.length + 1)))
      .join(""),
    body,
  );
});

test("long fences that fit the budget are retained when language metadata is dropped", () => {
  const fence = "`".repeat(10);
  const body = "```\n" + "x".repeat(60) + "\n```\n";
  const output = splitter.split(
    fence + "language".repeat(20) + "\n" + body + fence,
    32,
  );
  assert.ok(
    output.every(
      (text) =>
        text.length <= 32 &&
        text.startsWith(fence + "\n") &&
        text.endsWith("\n" + fence),
    ),
  );
  assert.equal(
    output
      .map((text) => text.slice(fence.length + 1, -(fence.length + 1)))
      .join(""),
    body,
  );
});
