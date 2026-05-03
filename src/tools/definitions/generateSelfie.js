import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  buildTemplateContext,
  renderTemplateFile,
} from "../../utils/renderTemplate.js";
import { buildImageToolContext } from "../imageToolContextUtils.js";

/** @type {import('../ActionRegistry.js').ToolDef} */
export default {
  name: "generate_selfie",
  enabled: true,
  platforms: ["*"],
  requires: [],

  declaration: {
    name: "generate_selfie",
    description:
      "Generate a casual smartphone-style selfie of the bot/character to share naturally in chat. This tool is specifically for images where the character's own face appears, so it always uses content/character/reference.png as the face reference. All parameters may be written in natural language. Prefer specific, vivid, detailed descriptions instead of short keywords.",
    parameters: {
      type: "object",
      properties: {
        scene: {
          type: "string",
          description:
            "Main environment or situation around the selfie. Example: cafe table, bedroom desk, rainy street, ramen shop counter",
        },
        purpose: {
          type: "string",
          description:
            "Why this selfie is being shared. Example: showing today's outfit, sharing mood, random update, asking opinion",
        },
        vibe: {
          type: "string",
          description:
            "Overall emotional vibe. Example: cozy, tired, excited, lonely, chaotic",
        },
        pose: {
          type: "string",
          description:
            "Selfie pose and expression. Example: peace sign, sleepy face, small smile, leaning on hand, playful wink",
        },
        framing: {
          type: "string",
          description:
            "Selfie framing. Example: close-up face, bust shot, mirror selfie, arm-length selfie, slightly tilted angle",
        },
        lighting: {
          type: "string",
          description:
            "Lighting style. Example: auto, warm indoor, monitor glow, streetlight, daylight",
        },
        details: {
          type: "array",
          items: { type: "string" },
          description: "Extra objects or scene hints.",
        },
        sourceImages: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. Leave empty or omit when creating a new selfie. Include previous generated image IDs, such as ['21dc101b'] or ['[IMAGE:21dc101b]'], only when the user wants to reuse, reference, or modify earlier images. The character reference image is always included automatically.",
        },
      },
      required: ["scene"],
    },
  },

  /**
   * @param {{ scene: string, purpose?: string, vibe?: string, pose?: string, framing?: string, lighting?: string, details?: string[], sourceImages?: string[] }} args
   * @param {Object} context
   */
  execute: async (args, context) => {
    const { aiService, configManager, generationRepository, channel } = context;
    if (!aiService) {
      throw new Error("AIService not available in tool context");
    }
    if (!generationRepository) {
      throw new Error("GenerationRepository not available in tool context");
    }
    if (!channel?.id) {
      throw new Error("Channel not available in tool context");
    }

    const promptName = configManager?.get("ai.image.prompt") || "default";
    const referenceImagePath = path.join(
      process.cwd(),
      "content",
      "character",
      "reference.png",
    );
    if (!fs.existsSync(referenceImagePath)) {
      throw new Error(
        "Selfie generation requires content/character/reference.png",
      );
    }
    const { sourceImagePaths, templateData } = buildImageToolContext(
      args,
      configManager,
    );

    const templatePath = path.join(
      process.cwd(),
      "content",
      "prompts",
      promptName,
      "image",
      "selfie.md",
    );
    const prompt = await renderTemplateFile(
      templatePath,
      buildTemplateContext(templateData),
    );

    const gen = await generationRepository.create({
      channelId: channel.id,
      type: "IMAGE",
      prompt: promptName,
      input: prompt,
      status: "PROCESSING",
    });
    const generationId = gen.id;

    let imageBuffer;
    let apiRequest = {
      prompt,
      referenceImage: referenceImagePath,
      sourceImages: sourceImagePaths,
    };
    let apiResponse = null;
    let imageId = crypto.randomBytes(4).toString("hex");
    let filename = `${imageId}.png`;

    try {
      const result = await aiService.generateImage(prompt, {
        image: [referenceImagePath, ...sourceImagePaths],
        size: "1024x1536",
      });
      imageBuffer = result.buffer || result;
      apiRequest = result.request || apiRequest;
      apiResponse = result.response || {
        status: "success",
        tool: "generate_selfie",
      };

      if (generationId) {
        await generationRepository.updateDetails(generationId, {
          apiRequest,
          apiResponse,
          output: filename,
        });
        await generationRepository.updateStatus(generationId, "COMPLETED");
      }
    } catch (err) {
      if (generationId) {
        await generationRepository.updateDetails(generationId, {
          apiRequest,
          apiResponse: { error: err.message, stack: err.stack },
        });
        await generationRepository.updateStatus(generationId, "FAILED");
      }
      throw err;
    }

    const imageDir = path.join(process.cwd(), "content", "image");

    // Ensure directory exists
    if (!fs.existsSync(imageDir)) {
      fs.mkdirSync(imageDir, { recursive: true });
    }

    const filePath = path.join(imageDir, filename);
    fs.writeFileSync(filePath, imageBuffer);

    return {
      status: "success",
      imageId: imageId,
      generationId,
      instruction: `Image generated successfully! You MUST include this tag somewhere in your response message exactly like this so the user can see it: [IMAGE:${imageId}]`,
      description: `Generated selfie for scene: ${args.scene}`,
    };
  },
};
