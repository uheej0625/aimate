import fs from "fs";
import path from "path";
import crypto from "crypto";
import { renderTemplateFile } from "../../utils/templateUtils.js";

/** @type {import('../ActionRegistry.js').ToolDef} */
export default {
  name: "generate_photo",
  enabled: true,
  platforms: ["*"],
  requires: [],

  declaration: {
    name: "generate_photo",
    description:
      "Generate a casual smartphone-style daily life photo that the bot shares naturally in chat. All parameters may be written in natural language. Prefer specific, vivid, detailed descriptions instead of short keywords.",
    parameters: {
      type: "object",
      properties: {
        scene: {
          type: "string",
          description:
            "Main environment or situation. Example: cafe table, bedroom desk, rainy street, ramen shop counter",
        },
        purpose: {
          type: "string",
          description:
            "Why this photo is being shared. Example: showing food, sharing mood, random update, asking opinion",
        },
        vibe: {
          type: "string",
          description:
            "Overall emotional vibe. Example: cozy, tired, excited, lonely, chaotic",
        },
        humanPresence: {
          type: "string",
          enum: ["none", "partial", "background", "auto"],
          description: "Whether people appear in the image.",
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
      },
      required: ["scene"],
    },
  },

  /**
   * @param {{ scene: string, purpose?: string, vibe?: string, humanPresence?: string, lighting?: string, details?: string[] }} args
   * @param {Object} context
   */
  execute: async (args, context) => {
    const { aiService, configManager, generationRepository, channel } = context;
    if (!aiService) {
      throw new Error("AIService not available in tool context");
    }

    const promptName = configManager?.get("ai.image.prompt") || "default";
    const templatePath = path.join(
      process.cwd(),
      "content",
      "prompts",
      promptName,
      "image",
      "photo.md",
    );
    const prompt = await renderTemplateFile(templatePath, args);

    let generationId = null;
    if (generationRepository && channel?.id) {
      const gen = await generationRepository.create({
        channelId: channel.id,
        type: "IMAGE",
        prompt: promptName,
        input: prompt,
        status: "PROCESSING",
      });
      generationId = gen.id;
    }

    let imageBuffer;
    let apiRequest = { prompt };
    let apiResponse = null;
    let imageId = crypto.randomBytes(4).toString("hex");
    let filename = `${imageId}.png`;

    try {
      const result = await aiService.generateImage(prompt);
      imageBuffer = result.buffer || result;
      apiRequest = result.request || apiRequest;
      apiResponse = result.response || {
        status: "success",
        tool: "generate_photo",
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
      instruction: `Image generated successfully! You MUST include this tag somewhere in your response message exactly like this so the user can see it: [IMAGE:${imageId}]`,
      description: `Generated photo for scene: ${args.scene}`,
    };
  },
};
