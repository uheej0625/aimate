import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  buildTemplateContext,
  renderTemplateFile,
} from "../utils/renderTemplate.js";
import {
  buildSourceImageContext,
  resolveSourceImagePaths,
} from "./imageReferenceUtils.js";
import { buildCurrentTimeContext } from "./timeContextUtils.js";

export async function executeImageGenerationTool(args, context, spec) {
  const { ai, configManager, generationRepository, channel } = context;
  assertImageToolContext({ ai, generationRepository, channel });

  const promptName = configManager?.get("ai.image.prompt") || "default";
  const sourceImagePaths = resolveSourceImagePaths(args.sourceImages);
  const referenceImagePaths = await resolveReferenceImagePaths(
    spec.referenceImages,
  );
  const prompt = await renderImagePrompt({
    args,
    configManager,
    promptName,
    sourceImages: args.sourceImages,
    templateFile: spec.templateFile,
  });

  const imageId = crypto.randomBytes(4).toString("hex");
  const filename = `${imageId}.png`;
  const generation = await generationRepository.create({
    channelId: channel.id,
    type: "IMAGE",
    prompt: promptName,
    input: prompt,
    status: "PROCESSING",
  });

  const generationId = generation.id;
  const imagePaths = [...referenceImagePaths, ...sourceImagePaths];
  const generateImageOptions = { ...spec.imageOptions };
  if (imagePaths.length > 0) {
    generateImageOptions.image = imagePaths;
  }
  const fallbackApiRequest = {
    prompt,
    referenceImages: referenceImagePaths,
    sourceImages: sourceImagePaths,
    options: spec.imageOptions ?? {},
  };
  if (imagePaths.length > 0) {
    fallbackApiRequest.image = imagePaths;
  }

  try {
    const result = await ai.generateImage(prompt, generateImageOptions);
    const imageBuffer = result.buffer || result;
    const outputPath = await writeGeneratedImage(filename, imageBuffer);

    await generationRepository.updateDetails(generationId, {
      apiRequest: result.request || fallbackApiRequest,
      apiResponse: result.response || {
        status: "success",
        tool: spec.toolName,
      },
      output: filename,
    });
    await generationRepository.updateStatus(generationId, "COMPLETED");

    return {
      status: "success",
      imageId,
      generationId,
      outputPath,
      instruction: `Image generated successfully! You MUST include this tag somewhere in your response message exactly like this so the user can see it: [IMAGE:${imageId}]`,
      description: spec.describe(args),
    };
  } catch (err) {
    await generationRepository.updateDetails(generationId, {
      apiRequest: fallbackApiRequest,
      apiResponse: { error: err.message, stack: err.stack },
    });
    await generationRepository.updateStatus(generationId, "FAILED");
    throw err;
  }
}

function assertImageToolContext({ ai, generationRepository, channel }) {
  if (!ai) {
    throw new Error("AI runtime not available in tool context");
  }
  if (!generationRepository) {
    throw new Error("GenerationRepository not available in tool context");
  }
  if (!channel?.id) {
    throw new Error("Channel not available in tool context");
  }
}

async function renderImagePrompt({
  args,
  configManager,
  promptName,
  sourceImages,
  templateFile,
}) {
  const includeTimeContext =
    configManager?.get("ai.image.includeTimeContext") !== false;
  const timeZone =
    configManager?.get("ai.image.timeZone") ||
    configManager?.get("app.timeZone") ||
    "Asia/Seoul";
  const templatePath = path.join(
    process.cwd(),
    "content",
    "prompts",
    promptName,
    "image",
    templateFile,
  );
  const templateData = {
    ...args,
    sourceImageRefs: buildSourceImageContext(sourceImages),
    includeTimeContext,
    ...(includeTimeContext ? buildCurrentTimeContext({ timeZone }) : {}),
  };

  return renderTemplateFile(templatePath, buildTemplateContext(templateData));
}

async function resolveReferenceImagePaths(referenceImages = []) {
  const paths = [];

  for (const reference of referenceImages) {
    const imagePath =
      typeof reference === "string" ? reference : reference.path;
    const requiredMessage =
      typeof reference === "string" ? null : reference.requiredMessage;

    try {
      await fs.access(imagePath);
    } catch {
      if (requiredMessage) {
        throw new Error(requiredMessage);
      }
      throw new Error(`Reference image not found: ${imagePath}`);
    }

    paths.push(imagePath);
  }

  return paths;
}

async function writeGeneratedImage(filename, imageBuffer) {
  const imageDir = path.join(process.cwd(), "content", "image");
  await fs.mkdir(imageDir, { recursive: true });

  const outputPath = path.join(imageDir, filename);
  await fs.writeFile(outputPath, imageBuffer);
  return outputPath;
}
