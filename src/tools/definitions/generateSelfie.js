import { jsonSchema } from "ai";
import path from "path";
import { executeImageGenerationTool } from "../ImageGenerationToolRunner.js";

/** @type {import('../ActionRegistry.js').ToolDef} */
export default {
  name: "generate_selfie",
  enabled: true,
  platforms: ["*"],
  requires: ["image"],

  description:
    "Generate a casual smartphone-style selfie of the bot/character to share naturally in chat. This tool is specifically for images where the character's own face appears, so it always uses content/character/reference.png as the face reference. All parameters may be written in natural language. Prefer specific, vivid, detailed descriptions instead of short keywords.",
  inputSchema: jsonSchema({
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
  }),

  /**
   * @param {{ scene: string, purpose?: string, vibe?: string, pose?: string, framing?: string, lighting?: string, details?: string[], sourceImages?: string[] }} args
   * @param {Object} context
   */
  execute: async (args, context) => {
    const referenceImagePath = path.join(
      process.cwd(),
      "content",
      "character",
      "reference.png",
    );
    return executeImageGenerationTool(args, context, {
      toolName: "generate_selfie",
      templateFile: "selfie.md",
      imageOptions: { size: "1024x1536" },
      referenceImages: [
        {
          path: referenceImagePath,
          requiredMessage:
            "Selfie generation requires content/character/reference.png",
        },
      ],
      describe: (toolArgs) => `Generated selfie for scene: ${toolArgs.scene}`,
    });
  },
};
