import fs from "fs/promises";
import { generateImage } from "ai";
import { createLogger } from "../core/logger.js";
import { getAiSettings, getProviderOptions, stripEmpty } from "./config.js";
import { createImageModel } from "./models.js";
import { serializeMetadata } from "./metadata.js";

const logger = createLogger("AiImages");

export async function generateImageFile(configManager, prompt, options = {}) {
  const settings = getAiSettings(configManager, "image");
  const imageModel = createImageModel(configManager, "image");
  const imagePaths = options.image
    ? Array.isArray(options.image)
      ? options.image
      : [options.image]
    : [];
  const imageBuffers = await Promise.all(
    imagePaths.map((imagePath) =>
      typeof imagePath === "string" ? fs.readFile(imagePath) : imagePath,
    ),
  );

  const request = stripEmpty({
    model: imageModel,
    prompt:
      imageBuffers.length > 0
        ? { text: prompt, images: imageBuffers }
        : prompt,
    size: options.size,
    providerOptions: getProviderOptions(settings),
    maxRetries: settings.maxRetries,
  });

  logger.info(
    {
      provider: settings.provider,
      model: settings.model,
      hasReferenceImages: imageBuffers.length > 0,
    },
    "Generating image",
  );

  const response = await generateImage(request);
  const image = response.image;

  if (!image?.uint8Array) {
    throw new Error("Image generation response did not include image data.");
  }

  return {
    buffer: Buffer.from(image.uint8Array),
    request: {
      provider: settings.provider,
      model: settings.model,
      prompt,
      size: options.size,
      providerOptions: request.providerOptions,
      image: imagePaths.map((imagePath) =>
        typeof imagePath === "string" ? imagePath : "[uploadable]",
      ),
    },
    response: serializeMetadata({
      mediaType: image.mediaType,
      warnings: response.warnings,
      responses: response.responses,
      providerMetadata: response.providerMetadata,
      usage: response.usage,
    }),
  };
}
