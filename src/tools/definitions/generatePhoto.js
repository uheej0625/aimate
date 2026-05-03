import { executeImageGenerationTool } from "../ImageGenerationToolRunner.js";

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
        sourceImages: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional. Leave empty or omit when creating a new image. Include previous generated image IDs, such as ['21dc101b'] or ['[IMAGE:21dc101b]'], only when the user wants to reuse, reference, or modify earlier images.",
        },
      },
      required: ["scene"],
    },
  },

  /**
   * @param {{ scene: string, purpose?: string, vibe?: string, humanPresence?: string, lighting?: string, details?: string[], sourceImages?: string[] }} args
   * @param {Object} context
   */
  execute: async (args, context) => {
    return executeImageGenerationTool(args, context, {
      toolName: "generate_photo",
      templateFile: "photo.md",
      describe: (toolArgs) => `Generated photo for scene: ${toolArgs.scene}`,
    });
  },
};
