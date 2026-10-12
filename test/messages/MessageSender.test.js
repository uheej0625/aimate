import test from "node:test";
import assert from "node:assert/strict";
import { MessageSender } from "../../src/messages/MessageSender.js";

test("MessageSender injects pacing after attachment resolution and reads current delay settings", async () => {
  const config = {
    "humanize.enabled": true,
    "humanize.typingDelayMin": 1000,
    "humanize.typingDelayMax": 2000,
    "humanize.typingDelayPerChar": 60,
  };
  const calls = [];
  const saved = [];
  const file = { attachment: "test.png" };
  const attachments = [{ type: "generated_image", imageId: "1234abcd" }];
  const message = { platformMessageId: "sent-1", content: "hello" };
  const sender = new MessageSender(
    { saveMessage: async (...args) => saved.push(args) },
    { findById: async () => ({ status: "GENERATED" }) },
    { get: (key) => config[key] },
    {
      generatedImageAttachmentResolver: {
        resolve: async () => ({
          cleanText: "hello",
          files: [file],
          generatedImageAttachments: attachments,
        }),
      },
      typingPacer: {
        calculate: (text, settings) => {
          calls.push([text, settings]);
          return 0;
        },
      },
    },
  );
  const sent = [];
  let typing = 0;
  const channel = {
    sendTyping: async () => typing++,
    send: async (options) => {
      sent.push(options);
      return message;
    },
  };
  assert.equal(await sender.send(channel, "hello [IMAGE:1234abcd]", 1), true);
  config["humanize.typingDelayMin"] = 500;
  assert.equal(await sender.send(channel, "hello [IMAGE:1234abcd]", 1), true);
  assert.deepEqual(calls, [
    ["hello", { min: 1000, max: 2000, perChar: 60 }],
    ["hello", { min: 500, max: 2000, perChar: 60 }],
  ]);
  assert.equal(typing, 2);
  assert.deepEqual(sent, [
    { content: "hello", files: [file] },
    { content: "hello", files: [file] },
  ]);
  assert.equal(saved[0][0], message);
  assert.equal(saved[0][1], 1);
  assert.equal(saved[0][2], attachments);
});

function createHarness(config) {
  const sent = [];
  const saved = [];
  const pacing = [];
  let typing = 0;
  const sender = new MessageSender(
    { saveMessage: async (message) => saved.push(message.content) },
    { findById: async () => ({ status: "GENERATED" }) },
    { get: (key) => config[key] },
    {
      generatedImageAttachmentResolver: {
        resolve: async (text) => ({
          cleanText: text,
          files: [],
          generatedImageAttachments: [],
        }),
      },
      typingPacer: {
        calculate: (text, settings) => {
          pacing.push({ text, settings });
          return 0;
        },
      },
    },
  );
  const channel = {
    sendTyping: async () => typing++,
    send: async ({ content }) => {
      assert.ok(content.length <= 2000);
      sent.push(content);
      return { platformMessageId: `sent-${sent.length}`, content };
    },
  };
  return { sender, channel, sent, saved, pacing, typing: () => typing };
}

test("disabled humanize splits and stores long messages without typing, pacing or timers", async (t) => {
  t.mock.method(globalThis, "setTimeout", () => {
    assert.fail("Disabled humanize must not wait before delivery");
  });
  const h = createHarness({ "humanize.enabled": false });
  let delivered = 0;
  const original = "x".repeat(4001);
  assert.equal(
    await h.sender.send(h.channel, original, 1, {
      onDelivered: () => delivered++,
    }),
    true,
  );
  assert.deepEqual(
    h.sent.map((text) => text.length),
    [1900, 1900, 201],
  );
  assert.equal(h.sent.join(""), original);
  assert.deepEqual(h.saved, h.sent);
  assert.equal(delivered, 3);
  assert.equal(h.typing(), 0);
  assert.deepEqual(h.pacing, []);
});

test("delivery reads changed split and humanize settings on the next message", async () => {
  const config = {
    "messages.maxLength": 32,
    "humanize.enabled": false,
    "humanize.typingDelayMin": 0,
    "humanize.typingDelayMax": 0,
    "humanize.typingDelayPerChar": 0,
  };
  const h = createHarness(config);
  await h.sender.send(h.channel, "x".repeat(70), 1);
  assert.deepEqual(
    h.sent.map((text) => text.length),
    [32, 32, 6],
  );
  assert.equal(h.typing(), 0);

  config["messages.maxLength"] = 40;
  config["humanize.enabled"] = true;
  await h.sender.send(h.channel, "x".repeat(70), 1);
  assert.deepEqual(
    h.sent.slice(3).map((text) => text.length),
    [40, 30],
  );
  assert.equal(h.typing(), 2);
  assert.equal(h.pacing.length, 2);

  config["humanize.enabled"] = false;
  await h.sender.send(h.channel, "second", 1);
  assert.equal(h.sent.at(-1), "second");
  assert.equal(h.typing(), 2);
  assert.equal(h.pacing.length, 2);
});

test("cancellation stops remaining split chunks even with humanize disabled", async () => {
  const h = createHarness({ "humanize.enabled": false });
  let current = true;
  assert.equal(
    await h.sender.send(h.channel, "x".repeat(4000), 1, {
      isCurrent: () => current,
      onDelivered: () => {
        current = false;
      },
    }),
    false,
  );
  assert.deepEqual(h.sent, ["x".repeat(1900)]);
  assert.deepEqual(h.saved, h.sent);
});

test("disabled humanize does not bypass invalid transport split settings", async () => {
  const h = createHarness({
    "humanize.enabled": false,
    "messages.maxLength": 2001,
  });
  await assert.rejects(h.sender.send(h.channel, "hello", 1), RangeError);
  assert.deepEqual(h.sent, []);
});
