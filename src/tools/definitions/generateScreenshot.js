import fs from "fs";
import path from "path";
import crypto from "crypto";
import { renderTemplateFile } from "../../utils/templateUtils.js";

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
      },
      required: ["screenType", "appContext"],
    },
  },

  /**
   * @param {{ screenType: string, appContext: string, purpose?: string }} args
   * @param {Object} context
   */
  execute: async (args, context) => {
    const { aiService, configManager, generationRepository, channel } = context;
    if (!aiService) {
      throw new Error("AIService not available in tool context");
    }

    const now = new Date();
    const currentDate = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const currentTime = now.toTimeString().split(" ")[0].substring(0, 5); // HH:MM

    const promptName = configManager?.get("ai.image.prompt") || "default";
    const templatePath = path.join(
      process.cwd(),
      "content",
      "prompts",
      promptName,
      "image",
      "screenshot.md",
    );
    const prompt = await renderTemplateFile(templatePath, {
      ...args,
      currentDate,
      currentTime,
    });

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
        tool: "generate_screenshot",
        currentDate,
        currentTime,
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
      description: `Generated screenshot for: ${args.appContext}`,
    };
  },
};
