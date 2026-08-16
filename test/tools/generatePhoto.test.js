import test from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import os from "os";
import path from "path";
import generatePhoto from "../../src/tools/definitions/generatePhoto.js";

test("generate_photo uses the selfie template and character reference only for selfie kind", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimate-photo-tool-"));
  process.chdir(tmpDir);

  try {
    await fs.mkdir(path.join(tmpDir, "content", "prompts", "test", "image"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpDir, "content", "characters", "test"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, "content", "prompts", "test", "image", "selfie.md"),
      "SELFIE {{data.scene}} {{data.framing}}",
    );
    await fs.writeFile(
      path.join(tmpDir, "content", "prompts", "test", "image", "photo.md"),
      "PHOTO {{data.scene}} {{data.framing}}",
    );
    await fs.writeFile(
      path.join(tmpDir, "content", "characters", "test", "reference.png"),
      "reference",
    );

    let receivedPrompt = null;
    let receivedOptions = null;
    const context = buildContext({
      generateImage: async (prompt, options) => {
        receivedPrompt = prompt;
        receivedOptions = options;
        return { buffer: Buffer.from("generated image") };
      },
    });

    await generatePhoto.execute(
      {
        kind: "selfie",
        scene: "pajamas mirror photo",
        framing: "mirror selfie",
      },
      context,
    );

    assert.match(receivedPrompt, /^SELFIE/);
    assert.deepStrictEqual(receivedOptions.image, [
      path.join(tmpDir, "content", "characters", "test", "reference.png"),
    ]);
    assert.strictEqual(receivedOptions.size, "1024x1536");
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("generate_photo uses plain photo generation for body-detail follow-ups", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimate-photo-tool-"));
  process.chdir(tmpDir);

  try {
    await fs.mkdir(path.join(tmpDir, "content", "prompts", "test", "image"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, "content", "prompts", "test", "image", "photo.md"),
      "PHOTO {{data.scene}} {{data.framing}}",
    );

    let receivedPrompt = null;
    let receivedOptions = null;
    const context = buildContext({
      generateImage: async (prompt, options) => {
        receivedPrompt = prompt;
        receivedOptions = options;
        return { buffer: Buffer.from("generated image") };
      },
    });

    await generatePhoto.execute(
      {
        kind: "photo",
        scene: "both socks now matching",
        humanPresence: "partial",
        framing: "close-up of feet on the floor",
      },
      context,
    );

    assert.match(receivedPrompt, /^PHOTO/);
    assert.ok(!Object.hasOwn(receivedOptions, "image"));
    assert.ok(!Object.hasOwn(receivedOptions, "size"));
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

function buildContext({ generateImage }) {
  return {
    imageGenerator: { generate: generateImage },
    characterId: "test",
    configManager: {
      get: (key) => {
        if (key === "ai.image.prompt") return "test";
        if (key === "character") return "test";
        return null;
      },
    },
    generationRepository: {
      create: async () => ({ id: "generation-id" }),
      updateDetails: async () => {},
      updateStatus: async () => {},
    },
    channel: { id: "channel-id" },
  };
}
