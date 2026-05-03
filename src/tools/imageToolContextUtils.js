import {
  buildSourceImageContext,
  resolveSourceImagePaths,
} from "./imageReferenceUtils.js";
import { buildCurrentTimeContext } from "./timeContextUtils.js";

export function buildImageToolContext(args, configManager) {
  const includeTimeContext =
    configManager?.get("ai.image.includeTimeContext") !== false;
  const timeZone =
    configManager?.get("ai.image.timeZone") ||
    configManager?.get("app.timeZone") ||
    "Asia/Seoul";
  const sourceImagePaths = resolveSourceImagePaths(args.sourceImages);

  return {
    sourceImagePaths,
    templateData: {
      ...args,
      sourceImageRefs: buildSourceImageContext(args.sourceImages),
      includeTimeContext,
      ...(includeTimeContext ? buildCurrentTimeContext({ timeZone }) : {}),
    },
  };
}
