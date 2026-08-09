/**
 * Returns a platform-neutral generation view for a stored message.
 */
export class GetGenerationInfo {
  constructor(messageRepository) {
    this.messageRepository = messageRepository;
  }

  async execute({ platform, platformMessageId }) {
    const message = await this.messageRepository.findByPlatformId(
      platform,
      platformMessageId,
    );

    if (!message) return null;
    if (!message.generation) return { generation: null };

    const generation = message.generation;
    return {
      generation: {
        id: generation.id,
        type: generation.type,
        status: generation.status,
        inputMessages:
          generation.type === "CHAT"
            ? parseChatInput(generation.input).messages
            : [],
        outputMessages:
          generation.type === "CHAT"
            ? parseStringArray(generation.output)
            : [],
        createdAt: generation.createdAt,
        updatedAt: generation.updatedAt,
      },
    };
  }
}

function parseChatInput(raw) {
  if (!raw) return { messages: [] };

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return {
        messages: parsed.map((content) => ({ id: null, content })),
      };
    }

    if (
      Array.isArray(parsed?.messageIds) &&
      parsed.messages?.every((message) => typeof message === "string")
    ) {
      return {
        messages: parsed.messages.map((content, index) => ({
          id: parsed.messageIds[index] ?? null,
          content,
        })),
      };
    }

    return {
      messages: Array.isArray(parsed?.messages)
        ? parsed.messages
            .map((message) => ({
              id: message?.id ?? null,
              content: message?.content ?? "",
            }))
            .filter((message) => message.content)
        : [],
    };
  } catch (_error) {
    return { messages: [] };
  }
}

function parseStringArray(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}
