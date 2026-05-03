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
  name: "generate_screenshot",
  enabled: true,
  platforms: ["*"],
  requires: [],

  declaration: {
    name: "generate_screenshot",
    description:
      "Generate a realistic smartphone or PC screenshot to share in chat. Use sparingly to keep it special and avoid high API costs. Good for spontaneously showing a digital UI like a funny social media post, a map route, or game stats when it makes the chat more engaging. Do not overuse it; rely on text mostly.",
    parameters: {
      type: "object",
      properties: {
        screenType: {
          type: "string",
          description:
            "Specific device model or screen type. Example: iPhone 15 Pro, Galaxy S24 Ultra, Windows PC, MacBook Pro",
        },
        appContext: {
          type: "string",
          description:
            "Detailed natural language description of the app or website being displayed. Elaborate on what is visible on the screen, reflecting the character's specific traits, tastes, and current situation.",
        },
        purpose: {
          type: "string",
          description:
            "Why this screenshot is being shared. Example: showing a route, sharing a funny post",
        },
        sourceImages: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. Leave empty or omit when creating a new screenshot. Include previous generated image IDs, such as ['21dc101b'] or ['[IMAGE:21dc101b]'], only when the user wants to reuse, reference, or modify earlier images.",
        },
      },
      required: ["screenType", "appContext"],
    },
  },

  /**
   * @param {{ screenType: string, appContext: string, purpose?: string, sourceImages?: string[] }} args
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
      "screenshot.md",
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
    let apiRequest = { prompt, sourceImages: sourceImagePaths };
    let apiResponse = null;
    let imageId = crypto.randomBytes(4).toString("hex");
    let filename = `${imageId}.png`;

    try {
      const result = await aiService.generateImage(prompt, {
        image: sourceImagePaths,
      });
      imageBuffer = result.buffer || result;
      apiRequest = result.request || apiRequest;
      apiResponse = result.response || {
        status: "success",
        tool: "generate_screenshot",
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
      description: `Generated screenshot for: ${args.appContext}`,
    };
  },
};
