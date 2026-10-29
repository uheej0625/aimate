import { generateText } from "ai";
import { getAiSettings, getGenerationSettings } from "./config.js";
import { createLanguageModel } from "./models.js";
import { loadAiCredentials } from "./credentials.js";
import {
  serializeMetadata,
  toRequestMetadata,
  toTextResultMetadata,
} from "./metadata.js";

/**
 * Runs a one-shot summary model call for auxiliary tasks such as memory extraction.
 */
export async function generateSummaryText({
  configManager,
  credentials = loadAiCredentials(),
  system,
  userMessage,
  generateTextFn = generateText,
  createLanguageModelFn = createLanguageModel,
}) {
  const settings = getAiSettings(configManager, "summary");
  const model = createLanguageModelFn(configManager, "summary", credentials);
  const messages = [{ role: "user", content: userMessage }];
  const request = {
    model,
    system,
    messages,
    ...getGenerationSettings(settings),
  };
  const requestMetadata = toRequestMetadata({
    settings,
    system: request.system,
    messages,
    tools: {},
    appTools: {},
  });
  const result = await generateTextFn(request);

  return {
    text: result.text,
    apiRequest: serializeMetadata(requestMetadata),
    apiResponse: serializeMetadata(toTextResultMetadata(result)),
  };
}
