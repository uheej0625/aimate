import fs from "fs/promises";
import { generateImage } from "ai";
import { createLogger, elapsedMs } from "../core/logger.js";
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
      imageBuffers.length > 0 ? { text: prompt, images: imageBuffers } : prompt,
    size: options.size,
    providerOptions: getProviderOptions(settings),
    maxRetries: settings.maxRetries,
    abortSignal: options.abortSignal,
  });

  logger.info(
    {
      event: "model.started",
      purpose: "image",
      provider: settings.provider,
      model: settings.model,
      hasReferenceImages: imageBuffers.length > 0,
    },
    "Generating image",
  );

  const startedAt = performance.now();
  let response;
  let image;
  try {
    response = await generateImage(request);
    image = response.image;
    if (!image?.uint8Array) {
      throw new Error("Image generation response did not include image data.");
    }
  } catch (error) {
    const cancelled =
      options.abortSignal?.aborted || error.name === "AbortError";
    logger[cancelled ? "debug" : "warn"](
      {
        event: cancelled ? "model.cancelled" : "model.failed",
        purpose: "image",
        provider: settings.provider,
        model: settings.model,
        errorType: error.name,
        statusCode: error.statusCode ?? error.lastError?.statusCode,
        durationMs: elapsedMs(startedAt),
      },
      "Image model ended without a result",
    );
    throw error;
  }
  logger.info(
    {
      event: "model.completed",
      purpose: "image",
      provider: settings.provider,
      model: settings.model,
      durationMs: elapsedMs(startedAt),
      imageBytes: image.uint8Array.length,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      totalTokens: response.usage?.totalTokens,
    },
    "Image model completed",
  );
  if (response.warnings?.length)
    logger.warn(
      {
        event: "model.warnings",
        purpose: "image",
        warningCount: response.warnings.length,
      },
      "Image model returned warnings",
    );

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
