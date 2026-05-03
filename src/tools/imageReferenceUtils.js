import fs from "fs";
import path from "path";

export const GENERATED_IMAGE_TAG_REGEX = /\[IMAGE:(.*?)\]/g;

export function normalizeImageId(value) {
  return String(value || "")
    .trim()
    .replace(/^\[IMAGE:/i, "")
    .replace(/\]$/, "")
    .replace(/\.(png|jpe?g|webp)$/i, "");
}

export function imageIdToFilename(imageId) {
  return `${normalizeImageId(imageId)}.png`;
}

export function imageIdToPath(imageId) {
  return path.join(
    process.cwd(),
    "content",
    "image",
    imageIdToFilename(imageId),
  );
}

export function resolveSourceImagePaths(sourceImages = []) {
  return coerceImageList(sourceImages).map((sourceImage) => {
    const imageId = normalizeImageId(sourceImage);
    const imagePath = imageIdToPath(imageId);

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Source image not found: [IMAGE:${imageId}]`);
    }

    return imagePath;
  });
}

export function buildSourceImageContext(sourceImages = []) {
  const imageIds = coerceImageList(sourceImages)
    .map(normalizeImageId)
    .filter(Boolean);
  if (imageIds.length === 0) {
    return "None";
  }

  return imageIds.map((imageId) => `[IMAGE:${imageId}]`).join(", ");
}

function coerceImageList(sourceImages = []) {
  if (!sourceImages) return [];
  const values = Array.isArray(sourceImages) ? sourceImages : [sourceImages];
  return values.filter((value) => normalizeImageId(value));
}
