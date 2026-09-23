import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GeneratedImageAttachmentResolver } from "../../src/messages/GeneratedImageAttachmentResolver.js";

test("GeneratedImageAttachmentResolver only attaches completed app-generated image files", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimate-image-tags-"));
  process.chdir(tmpDir);

  try {
    const imageId = "a1b2c3d4";
    const filename = `${imageId}.png`;
    const imageDir = path.join(tmpDir, "content", "image");
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(path.join(imageDir, filename), "generated");

    const requested = [];
    const resolver = new GeneratedImageAttachmentResolver({
      findCompletedImageByOutput: async (output) => {
        requested.push(output);
        return output === filename ? { id: 42, type: "IMAGE" } : null;
      },
    });
    const result = await resolver.resolve(
      "ok [IMAGE:a1b2c3d4] [IMAGE:../secret] [IMAGE:C:\\Windows\\win.ini] [IMAGE:https://example.com/image.png] [IMAGE:deadbeef]",
    );

    assert.equal(result.cleanText, "ok");
    assert.deepEqual(result.files, [
      { attachment: path.join(imageDir, filename) },
    ]);
    assert.deepEqual(result.generatedImageAttachments, [
      { type: "generated_image", imageId, filename, generationId: 42 },
    ]);
    assert.deepEqual(requested, [filename, "deadbeef.png"]);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("GeneratedImageAttachmentResolver rejects a non-image generation", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimate-image-tags-"));
  process.chdir(tmpDir);

  try {
    const imageId = "a1b2c3d4";
    const imageDir = path.join(tmpDir, "content", "image");
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(path.join(imageDir, `${imageId}.png`), "not enough");
    const resolver = new GeneratedImageAttachmentResolver({
      findCompletedImageByOutput: async () => ({ id: 43, type: "CHAT" }),
    });

    const result = await resolver.resolve(`[IMAGE:${imageId}]`);

    assert.equal(result.cleanText, "");
    assert.deepEqual(result.files, []);
    assert.deepEqual(result.generatedImageAttachments, []);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
