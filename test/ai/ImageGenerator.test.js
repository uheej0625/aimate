import test from "node:test";
import assert from "node:assert";
import { ImageGenerator } from "../../src/ai/ImageGenerator.js";

test("ImageGenerator delegates to the configured image function", async () => {
  const configManager = {};
  let received = null;
  const generator = new ImageGenerator(configManager, {
    generateImageFileFn: async (...args) => {
      received = args;
      return { buffer: Buffer.from("image") };
    },
  });
  const options = { size: "1024x1024" };

  const result = await generator.generate("a photo", options);

  assert.deepStrictEqual(received, [configManager, "a photo", options]);
  assert.deepStrictEqual(result.buffer, Buffer.from("image"));
});

test("ImageGenerator forwards an abort signal to the image implementation", async () => {
  const controller = new AbortController();
  let receivedOptions;
  const generator = new ImageGenerator({}, {
    generateImageFileFn: async (_config, _prompt, options) => {
      receivedOptions = options;
      return { buffer: Buffer.from("image") };
    },
  });

  await generator.generate("a photo", { abortSignal: controller.signal });

  assert.strictEqual(receivedOptions.abortSignal, controller.signal);
});
