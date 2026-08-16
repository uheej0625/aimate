import { generateSummaryText } from "../ai/summary.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("MemoryExtractor");

const EXTRACTION_SYSTEM = `You extract durable facts about a user from a single conversation turn.
Return JSON only with this shape:
{"memories":[{"content":"short fact in Korean","category":"fact|preference|story","importance":1-5}]}
Include only NEW facts that are not already listed in existing memories.
If there is nothing new to remember, return {"memories":[]}.`;

/**
 * Extracts and stores user memories after a completed chat generation.
 */
export class MemoryExtractor {
  /**
   * @param {import('../repositories/MemoryRepository.js').MemoryRepository} memoryRepository
   * @param {import('../repositories/UserRepository.js').UserRepository} userRepository
   * @param {import('../repositories/MessageRepository.js').MessageRepository} messageRepository
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {{ generateSummaryTextFn?: typeof generateSummaryText }} [options]
   */
  constructor(
    memoryRepository,
    userRepository,
    messageRepository,
    configManager,
    { generateSummaryTextFn = generateSummaryText } = {},
  ) {
    this.memoryRepository = memoryRepository;
    this.userRepository = userRepository;
    this.messageRepository = messageRepository;
    this.configManager = configManager;
    this.generateSummaryTextFn = generateSummaryTextFn;
  }

  /**
   * @param {{ generation: Object, channelRecord: Object, aiResult: Object }} payload
   */
  async extractFromGeneration({ generation, aiResult }) {
    if (!this.configManager.get("conversation.enableMemory")) return;

    const parsedInput = parseGenerationInput(generation.input);
    if (!parsedInput.messages.length) return;

    const firstMessageId = parsedInput.messages.find((m) => m.id)?.id;
    if (!firstMessageId) return;

    const sourceMessage = await this.messageRepository.findById(firstMessageId);
    if (!sourceMessage?.authorId) return;

    const user = await this.userRepository.findByPlatformAccountId(
      sourceMessage.authorId,
    );
    if (!user) return;

    const existing = await this.memoryRepository.findByUserId(user.id);
    const existingLines =
      existing.length > 0
        ? existing.map((memory) => `- ${memory.content}`).join("\n")
        : "(none)";

    const userLines = parsedInput.messages
      .map((message) => message.content)
      .join("\n");
    const assistantLines = (aiResult?.messages ?? []).join("\n");

    const userMessage = `Existing memories:\n${existingLines}\n\nUser messages:\n${userLines}\n\nAssistant replies:\n${assistantLines}`;

    try {
      const { text } = await this.generateSummaryTextFn({
        configManager: this.configManager,
        system: EXTRACTION_SYSTEM,
        userMessage,
      });
      const extracted = parseExtractionResponse(text);
      if (!extracted.length) return;

      for (const memory of extracted) {
        if (await this.memoryRepository.existsByContent(user.id, memory.content)) {
          continue;
        }

        await this.memoryRepository.create({
          userId: user.id,
          platformAccountId: sourceMessage.authorId,
          content: memory.content,
          category: memory.category,
          importance: memory.importance,
          messageId: firstMessageId,
        });
      }
    } catch (error) {
      logger.error({ err: error, generationId: generation.id }, "Memory extraction failed");
    }
  }
}

function parseGenerationInput(rawInput) {
  if (!rawInput) return { messages: [] };

  try {
    const parsed = JSON.parse(rawInput);
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    return {
      messages: messages.filter(
        (message) =>
          message &&
          typeof message.content === "string" &&
          message.content.trim() !== "",
      ),
    };
  } catch {
    return { messages: [] };
  }
}

function parseExtractionResponse(text) {
  if (typeof text !== "string" || !text.trim()) return [];

  let candidate = text.trim();
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) candidate = fenced[1].trim();

  try {
    const parsed = JSON.parse(candidate);
    const memories = Array.isArray(parsed?.memories) ? parsed.memories : [];
    return memories
      .filter(
        (memory) =>
          memory &&
          typeof memory.content === "string" &&
          memory.content.trim() !== "",
      )
      .map((memory) => ({
        content: memory.content.trim(),
        category: normalizeCategory(memory.category),
        importance: normalizeImportance(memory.importance),
      }));
  } catch {
    return [];
  }
}

function normalizeCategory(category) {
  const value = typeof category === "string" ? category.trim().toLowerCase() : "";
  if (value === "preference" || value === "story") return value;
  return "fact";
}

function normalizeImportance(importance) {
  const value = Number(importance);
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value)));
}
