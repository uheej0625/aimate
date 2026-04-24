import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

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
   */
  execute: async ({ subject, mood }) => {},
};
