import test from "node:test";
import assert from "node:assert/strict";
import { TypingPacer } from "../../src/humanize/TypingPacer.js";

const pacer = new TypingPacer();
const settings = { min: 1000, max: 2000, perChar: 60 };

test("TypingPacer preserves minimum, proportional and maximum delays", () => {
  assert.equal(pacer.calculate("", settings), 1000);
  assert.equal(pacer.calculate("hi", settings), 1000);
  assert.equal(pacer.calculate("a".repeat(25), settings), 1500);
  assert.equal(pacer.calculate("a".repeat(100), settings), 2000);
});

test("TypingPacer uses the supplied settings on each call, including zero delay", () => {
  assert.equal(pacer.calculate("hello", { min: 0, max: 0, perChar: 0 }), 0);
  assert.equal(pacer.calculate("hello", { min: 0, max: 100, perChar: 10 }), 50);
});
