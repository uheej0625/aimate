import { jsonSchema } from "ai";
import path from "path";
import { executeImageGenerationTool } from "../ImageGenerationToolRunner.js";

/** @type {import('../ActionRegistry.js').ToolDef} */
export default {
  name: "generate_photo",
  enabled: true,
  platforms: ["*"],
  requires: ["image"],

  description:
    "Generate a casual smartphone-style image that the bot shares naturally in chat. Use kind='selfie' only when the character's own face should be visible as the main subject. Use kind='photo' for everyday snapshots, objects, outfits, feet/socks/shoes, room details, food, scenery, or any image where the character's face does not need to be the focus. All parameters may be written in natural language. Prefer specific, vivid, detailed descriptions instead of short keywords.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["photo", "selfie"],
        description:
          "Choose 'selfie' only for face-visible self-portraits. Choose 'photo' for normal snapshots, object/food/room/outfit/feet/socks/shoes/body-detail shots, or when continuing a previously generated scene without needing the face.",
      },
      scene: {
        type: "string",
        description:
          "Main environment, subject, or situation. Example: cafe table, bedroom desk, rainy street, ramen shop counter, both socks now matching, close-up of feet on the floor",
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
        description:
          "For kind='photo', whether people appear in the image. Use partial for hands/legs/feet/outfit details without a face. For kind='selfie', this can be omitted.",
      },
      pose: {
        type: "string",
        description:
          "For kind='selfie', selfie pose and expression. For kind='photo', only use if a body detail or posture matters.",
      },
      framing: {
        type: "string",
        description:
          "Camera framing. For kind='selfie', face-visible selfie framing. For kind='photo', use practical framing such as close-up of feet, desk snapshot, outfit crop, room corner, food close-up.",
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
    required: ["kind", "scene"],
  }),

  /**
   * @param {{ kind: 'photo'|'selfie', scene: string, purpose?: string, vibe?: string, humanPresence?: string, pose?: string, framing?: string, lighting?: string, details?: string[], sourceImages?: string[] }} args
   * @param {Object} context
   */
  execute: async (args, context) => {
    return executeImageGenerationTool(args, context, buildPhotoSpec(args));
  },
};

export function buildPhotoSpec(args) {
  if (args.kind === "selfie") {
    const referenceImagePath = path.join(
      process.cwd(),
      "content",
      "character",
      "reference.png",
    );

    return {
      toolName: "generate_photo",
      templateFile: "selfie.md",
      imageOptions: { size: "1024x1536" },
      referenceImages: [
        {
          path: referenceImagePath,
          requiredMessage:
            "Selfie photo generation requires content/character/reference.png",
        },
      ],
      describe: (toolArgs) =>
        `Generated selfie-style photo for scene: ${toolArgs.scene}`,
    };
  }

  return {
    toolName: "generate_photo",
    templateFile: "photo.md",
    describe: (toolArgs) => `Generated photo for scene: ${toolArgs.scene}`,
  };
}
