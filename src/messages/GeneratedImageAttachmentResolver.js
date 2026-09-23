import fs from "fs";
import {
  GENERATED_IMAGE_TAG_REGEX,
  imageIdToFilename,
  imageIdToPath,
  normalizeImageId,
} from "../tools/imageReferenceUtils.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("GeneratedImageAttachmentResolver");
const GENERATED_IMAGE_ID_REGEX = /^[a-f0-9]{8}$/;

/**
 * Resolves [IMAGE:*] tags in model text into Discord file attachments.
 */
export class GeneratedImageAttachmentResolver {
  constructor(generationRepository) {
    this.generationRepository = generationRepository;
  }

  async resolve(text) {
    const files = [];
    const generatedImageAttachments = [];
    let match;

    GENERATED_IMAGE_TAG_REGEX.lastIndex = 0;
    while ((match = GENERATED_IMAGE_TAG_REGEX.exec(text)) !== null) {
      const parsedValue = match[1].trim();
      const imageId = normalizeImageId(parsedValue);
      if (!GENERATED_IMAGE_ID_REGEX.test(imageId)) {
        logger.warn(
          { imageId: parsedValue },
          "Invalid generated image ID, skipping attachment",
        );
        continue;
      }

      const filename = imageIdToFilename(imageId);
      const generation =
        await this.generationRepository.findCompletedImageByOutput(filename);
      if (!generation || generation.type !== "IMAGE") {
        logger.warn(
          { imageId },
          "Completed image generation not found, skipping attachment",
        );
        continue;
      }

      const localPath = imageIdToPath(imageId);
      if (!isRegularFile(localPath)) {
        logger.warn(
          { imageId },
          "Generated image file not found, skipping attachment",
        );
        continue;
      }

      files.push({ attachment: localPath });
      generatedImageAttachments.push({
        type: "generated_image",
        imageId,
        filename,
        generationId: generation.id,
      });
    }

    GENERATED_IMAGE_TAG_REGEX.lastIndex = 0;
    return {
      cleanText: text.replace(GENERATED_IMAGE_TAG_REGEX, "").trim(),
      files,
      generatedImageAttachments,
    };
  }

}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
