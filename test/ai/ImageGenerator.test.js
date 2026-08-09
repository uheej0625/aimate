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
