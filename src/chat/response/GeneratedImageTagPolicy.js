import {
  GENERATED_IMAGE_TAG_REGEX,
  normalizeImageId,
} from "../../tools/imageReferenceUtils.js";

/**
 * Keeps generated image references visible when tool results include them.
 */
export class GeneratedImageTagPolicy {
  extractFromToolResults(toolResults = []) {
    const tags = [];
    const addImageId = (imageId) => {
      const normalized = normalizeImageId(imageId);
      if (normalized) tags.push(`[IMAGE:${normalized}]`);
    };

    for (const result of toolResults) {
      if (!result || result.error) continue;

      if (result.imageId) {
        addImageId(result.imageId);
      }

      if (result.instruction) {
        GENERATED_IMAGE_TAG_REGEX.lastIndex = 0;
        let match;
        while (
          (match = GENERATED_IMAGE_TAG_REGEX.exec(result.instruction)) !== null
        ) {
          addImageId(match[1]);
        }
      }
    }

    return [...new Set(tags)];
  }

  appendMissingTags(parsed, generatedImageTags = []) {
    if (!generatedImageTags.length) return parsed;

    const messages = [...(parsed.messages ?? [])];
    const existingText = messages.join("\n");
    const missingTags = generatedImageTags.filter(
      (tag) => !existingText.includes(tag),
    );
    if (!missingTags.length) return parsed;

    if (messages.length === 0) {
      return {
        ...parsed,
        messages: missingTags,
      };
    }

    const lastIndex = messages.length - 1;
    messages[lastIndex] =
      `${messages[lastIndex]}\n${missingTags.join("\n")}`.trim();

    return {
      ...parsed,
      messages,
    };
  }
}
