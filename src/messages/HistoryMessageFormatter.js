/**
 * Converts persisted message records into model-ready history messages.
 */
export class HistoryMessageFormatter {
  format(messages, promptByGenerationId = new Map()) {
    return messages.map((message) =>
      this.formatMessage(message, promptByGenerationId),
    );
  }

  formatMessage(message, promptByGenerationId = new Map()) {
    return {
      id: message.id,
      authorId: message.authorId,
      authorPlatformId: message.author?.platformId ?? message.authorPlatformId,
      content: this.renderContentForAI(message, promptByGenerationId),
      createdAt: message.createdAt,
    };
  }

  extractGeneratedImageGenerationIds(messages) {
    return [
      ...new Set(
        messages.flatMap((message) =>
          this.parseAttachments(message.attachmentsJson)
            .filter((attachment) => attachment?.type === "generated_image")
            .map((attachment) => attachment.generationId)
            .filter(Boolean),
        ),
      ),
    ];
  }

  renderContentForAI(message, promptByGenerationId = new Map()) {
    const content = message.content || "";
    const attachments = this.parseAttachments(message.attachmentsJson);
    const generatedImages = attachments.filter(
      (attachment) =>
        attachment?.type === "generated_image" && attachment.imageId,
    );

    if (generatedImages.length === 0) {
      return content;
    }

    const imageLines = generatedImages.map((image) => {
      const prompt =
        promptByGenerationId.get(image.generationId) || image.prompt;
      const promptLine = prompt ? ` Prompt: ${prompt}` : "";
      return `- [IMAGE:${image.imageId}] (${image.filename || `${image.imageId}.png`}).${promptLine}`;
    });

    return [content, "Attached generated images:", ...imageLines]
      .filter(Boolean)
      .join("\n");
  }

  parseAttachments(attachmentsJson) {
    if (!attachmentsJson) return [];

    try {
      const parsed = JSON.parse(attachmentsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
