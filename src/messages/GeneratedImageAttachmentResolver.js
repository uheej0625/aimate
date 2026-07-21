import fs from "fs";
import {
  GENERATED_IMAGE_TAG_REGEX,
  imageIdToFilename,
  imageIdToPath,
  normalizeImageId,
} from "../tools/imageReferenceUtils.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("GeneratedImageAttachmentResolver");

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
      let attachmentPath = parsedValue;

      if (!parsedValue.includes("/") && !parsedValue.includes("\\")) {
        const imageId = normalizeImageId(parsedValue);
        const filename = imageIdToFilename(imageId);
        const localPath = imageIdToPath(imageId);

        if (!fs.existsSync(localPath)) {
          logger.warn(
            { imageId: parsedValue },
            "Image file not found, skipping attachment",
          );
          continue;
        }

        attachmentPath = localPath;
        generatedImageAttachments.push(
          await this._buildGeneratedImageAttachment(imageId, filename),
        );
      }

      files.push({ attachment: attachmentPath });
    }

    GENERATED_IMAGE_TAG_REGEX.lastIndex = 0;
    return {
      cleanText: text.replace(GENERATED_IMAGE_TAG_REGEX, "").trim(),
      files,
      generatedImageAttachments,
    };
  }

  async _buildGeneratedImageAttachment(imageId, filename) {
    const generation =
      await this.generationRepository.findCompletedImageByOutput(filename);

    return {
      type: "generated_image",
      imageId,
      filename,
      generationId: generation?.id ?? null,
    };
  }
}
