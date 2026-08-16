import test from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { executeImageGenerationTool } from "../../src/tools/ImageGenerationToolRunner.js";

test("executeImageGenerationTool renders prompts, passes references, and records output", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimate-image-tool-"));
  process.chdir(tmpDir);

  try {
    await fs.mkdir(path.join(tmpDir, "content", "prompts", "test", "image"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpDir, "content", "character"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmpDir, "content", "image"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, "content", "prompts", "test", "image", "photo.md"),
      "Scene={{data.scene}}\nSources={{data.sourceImageRefs}}\nTime={{data.hour}}",
    );
    await fs.writeFile(
      path.join(tmpDir, "content", "character", "reference.png"),
      "reference",
    );
    await fs.writeFile(
      path.join(tmpDir, "content", "image", "source123.png"),
      "source",
    );

    const calls = [];
    const generationRepository = {
      create: async (data) => {
        calls.push(["create", data]);
        return { id: "gen-1" };
      },
      updateDetails: async (generationId, details) => {
        calls.push(["updateDetails", generationId, details]);
      },
      updateStatus: async (generationId, status) => {
        calls.push(["updateStatus", generationId, status]);
      },
    };
    const generated = Buffer.from("generated image");
    const imageGenerator = {
      generate: async (prompt, options) => {
        calls.push(["generateImage", prompt, options]);
        return {
          buffer: generated,
          request: { prompt, image: options.image },
          response: { ok: true },
        };
      },
    };
    const configManager = {
      get: (key) => {
        if (key === "ai.image.prompt") return "test";
        if (key === "app.timeZone") return "Asia/Seoul";
        return null;
      },
    };

    const result = await executeImageGenerationTool(
      { scene: "cafe", sourceImages: ["[IMAGE:source123]"] },
      {
        imageGenerator,
        configManager,
        generationRepository,
        channel: { id: "channel-1" },
      },
      {
        toolName: "generate_photo",
        templateFile: "photo.md",
        imageOptions: { size: "1024x1024" },
        referenceImages: [
          path.join(tmpDir, "content", "character", "reference.png"),
        ],
        describe: (args) => `Generated photo for scene: ${args.scene}`,
      },
    );

    const generateCall = calls.find(([name]) => name === "generateImage");
    assert.match(generateCall[1], /Scene=cafe/);
    assert.match(generateCall[1], /Sources=\[IMAGE:source123\]/);
    assert.deepStrictEqual(generateCall[2].image, [
      path.join(tmpDir, "content", "character", "reference.png"),
      path.join(tmpDir, "content", "image", "source123.png"),
    ]);
    assert.strictEqual(generateCall[2].size, "1024x1024");

    const updateDetailsCall = calls.find(([name]) => name === "updateDetails");
    assert.match(updateDetailsCall[2].output, /^[a-f0-9]{8}\.png$/);
    assert.deepStrictEqual(
      await fs.readFile(
        path.join(tmpDir, "content", "image", result.imageId + ".png"),
      ),
      generated,
    );
    assert.deepStrictEqual(calls.at(-1), [
      "updateStatus",
      "gen-1",
      "COMPLETED",
    ]);
    assert.match(
      result.instruction,
      new RegExp(`\\[IMAGE:${result.imageId}\\]`),
    );
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("executeImageGenerationTool marks the generation failed when image generation throws", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimate-image-tool-"));
  process.chdir(tmpDir);

  try {
    await fs.mkdir(path.join(tmpDir, "content", "prompts", "test", "image"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, "content", "prompts", "test", "image", "photo.md"),
      "Scene={{data.scene}}",
    );

    const statuses = [];
    const generationRepository = {
      create: async () => ({ id: "gen-2" }),
      updateDetails: async (_generationId, details) => {
        assert.strictEqual(details.apiResponse.error, "boom");
      },
      updateStatus: async (_generationId, status) => {
        statuses.push(status);
      },
    };

    await assert.rejects(
      executeImageGenerationTool(
        { scene: "desk" },
        {
          imageGenerator: {
            generate: async () => {
              throw new Error("boom");
            },
          },
          configManager: {
            get: (key) => (key === "ai.image.prompt" ? "test" : null),
          },
          generationRepository,
          channel: { id: "channel-1" },
        },
        {
          toolName: "generate_photo",
          templateFile: "photo.md",
          describe: () => "Generated photo",
        },
      ),
      /boom/,
    );

    assert.deepStrictEqual(statuses, ["FAILED"]);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("executeImageGenerationTool does not pass image references when none are requested", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimate-image-tool-"));
  process.chdir(tmpDir);

  try {
    await fs.mkdir(path.join(tmpDir, "content", "prompts", "test", "image"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, "content", "prompts", "test", "image", "photo.md"),
      "Scene={{data.scene}}\nSources={{data.sourceImageRefs}}",
    );

    let receivedOptions = null;
    const generationRepository = {
      create: async () => ({ id: "gen-3" }),
      updateDetails: async () => {},
      updateStatus: async () => {},
    };

    await executeImageGenerationTool(
      { scene: "new ramen shop" },
      {
        imageGenerator: {
          generate: async (_prompt, options) => {
            receivedOptions = options;
            return { buffer: Buffer.from("generated image") };
          },
        },
        configManager: {
          get: (key) => (key === "ai.image.prompt" ? "test" : null),
        },
        generationRepository,
        channel: { id: "channel-1" },
      },
      {
        toolName: "generate_photo",
        templateFile: "photo.md",
        describe: () => "Generated photo",
      },
    );

    assert.ok(!Object.hasOwn(receivedOptions, "image"));
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
