import { jsonSchema } from "ai";
import { executeImageGenerationTool } from "../ImageGenerationToolRunner.js";

/** @type {import('../ActionRegistry.js').ToolDef} */
export default {
  name: "generate_screenshot",
  enabled: true,
  platforms: ["*"],
  requires: ["image"],

  description:
    "Generate a realistic smartphone or PC screenshot to share in chat. Use sparingly to keep it special and avoid high API costs. Good for spontaneously showing a digital UI like a funny social media post, a map route, or game stats when it makes the chat more engaging. Do not overuse it; rely on text mostly.",
  inputSchema: jsonSchema({
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
  }),

  /**
   * @param {{ screenType: string, appContext: string, purpose?: string, sourceImages?: string[] }} args
   * @param {Object} context
   */
  execute: async (args, context) => {
    return executeImageGenerationTool(args, context, {
      toolName: "generate_screenshot",
      templateFile: "screenshot.md",
      describe: (toolArgs) =>
        `Generated screenshot for: ${toolArgs.appContext}`,
    });
  },
};
