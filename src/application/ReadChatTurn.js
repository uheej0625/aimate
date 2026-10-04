/** Reads only conversation-facing evidence, never request bodies or headers. */
export class ReadChatTurn {
  constructor(messageRepository) {
    this.messageRepository = messageRepository;
  }

  async execute({ platform, platformMessageId }) {
    const input = await this.messageRepository.findByPlatformId(
      platform,
      platformMessageId,
    );
    if (!input) return null;
    const generation = input.generation;
    const records = generation
      ? await this.messageRepository.findByGenerationId(generation.id)
      : [];
    const metadata = parseJson(generation?.apiResponse, {});
    const response = Array.isArray(metadata)
      ? (metadata.at(-1) ?? {})
      : metadata;
    const steps = (response.steps ?? []).map((step) => ({
      text: step.text ?? "",
      toolCalls: (step.toolCalls ?? []).map(({ toolName, input }) => ({
        toolName,
        input,
      })),
      toolResults: (step.toolResults ?? []).map(({ toolName, output }) => ({
        toolName,
        output,
      })),
    }));
    if (response.recoveredTextToolCall) {
      const { toolName, input, output } = response.recoveredTextToolCall;
      steps.push({
        text: "",
        toolCalls: [{ toolName, input }],
        toolResults: [{ toolName, output }],
      });
    }
    return {
      status: generation?.status ?? "INTERRUPTED",
      generationId: generation?.id ?? null,
      messages: records
        .filter((record) => record.isBot)
        .map((record) => ({
          id: record.platformId,
          content: record.content,
          attachments: parseJson(record.attachmentsJson, []),
        })),
      rawText: response.text ?? "",
      steps,
      usage: tokenUsage(response.totalUsage ?? response.usage),
    };
  }
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function tokenUsage(value) {
  return Object.fromEntries(
    ["inputTokens", "outputTokens", "totalTokens"].map((key) => [
      key,
      Number.isFinite(value?.[key]) ? value[key] : null,
    ]),
  );
}
