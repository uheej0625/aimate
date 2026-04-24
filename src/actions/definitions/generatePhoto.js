import fs from "fs";
import path from "path";
import os from "os";

/** @type {import('../ActionRegistry.js').ToolDef} */
export default {
  name: "generate_photo",
  enabled: true,
  platforms: ["*"],
  requires: [],

  declaration: {
    name: "generate_photo",
    description:
      "Generate a realistic smartphone-style photo of an object, place, food, pet, or scene. No person visible.",
    parameters: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description:
            "Main thing being photographed. Example: ramen on desk, rainy street, coffee on cafe table",
        },
        mood: {
          type: "string",
          description:
            "Atmosphere or vibe. Example: cozy, messy, late night, sunny, casual",
        },
      },
      required: ["subject"],
    },
  },

  /**
   * @param {{ subject: string, mood?: string }} args
   * @param {Object} context
   */
  execute: async ({ subject, mood }, context) => {
    const { aiService } = context;
    if (!aiService) {
      throw new Error("AIService not available in tool context");
    }

    const prompt = mood ? `${subject}, ${mood} atmosphere` : subject;
    const imageBuffer = await aiService.generateImage(prompt);

    const filename = `photo_${Date.now()}.png`;
    const tempFilePath = path.join(os.tmpdir(), filename);

    fs.writeFileSync(tempFilePath, imageBuffer);

    return {
      status: "success",
      filePath: tempFilePath,
      description: `Generated photo of ${subject}`,
    };
  },
};
