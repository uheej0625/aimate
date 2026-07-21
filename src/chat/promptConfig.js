export function getRequiredChatPromptName(configManager) {
  const promptName = configManager?.get("ai.chat.prompt");

  if (typeof promptName !== "string" || promptName.trim() === "") {
    throw new Error("Missing required configuration: ai.chat.prompt");
  }

  return promptName.trim();
}
