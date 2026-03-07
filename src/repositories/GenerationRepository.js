import { prisma } from "../database/client.js";

/**
 * Repository for Generation database operations.
 * Handles AI generation tracking and status management.
 */
export class GenerationRepository {
  /**
   * Create a new generation record.
   * @param {Object} generationData - Generation data
   * @returns {Promise<Object>} The created generation record
   */
  async create(generationData) {
    const {
      channelId,
      messageIdsJson = "[]",
      status = "PENDING",
    } = generationData;

    return await prisma.generation.create({
      data: {
        channelId,
        messageIdsJson,
        status,
      },
    });
  }

  /**
   * Update generation status.
   * @param {string} generationId - Generation ID
   * @param {string} status - New status
   * @returns {Promise<Object>}
   */
  async updateStatus(generationId, status) {
    return await prisma.generation.update({
      where: { id: generationId },
      data: { status },
    });
  }

  /**
   * Cancel all processing/generated generations for a channel.
   * @param {string} channelId - Channel ID
   * @returns {Promise<number>} Number of cancelled generations
   */
  async cancelProcessing(channelId) {
    const result = await prisma.generation.updateMany({
      where: {
        channelId,
        status: { in: ["PROCESSING", "GENERATED"] },
      },
      data: {
        status: "CANCELLED",
      },
    });
    return result.count;
  }

  /**
   * Find a generation by ID.
   * @param {string} generationId - Generation ID
   * @returns {Promise<Object|null>}
   */
  async findById(generationId) {
    return await prisma.generation.findUnique({
      where: { id: generationId },
    });
  }

  /**
   * Execute a transaction to check and update generation status.
   * @param {string} generationId - Generation ID
   * @param {string} newStatus - New status to set
   * @returns {Promise<{shouldProceed: boolean}>}
   */
  async checkAndUpdateStatus(generationId, newStatus) {
    return await prisma.$transaction(async (tx) => {
      const generation = await tx.generation.findUnique({
        where: { id: generationId },
      });

      if (!generation || generation.status === "CANCELLED") {
        return { shouldProceed: false };
      }

      await tx.generation.update({
        where: { id: generationId },
        data: { status: newStatus },
      });

      return { shouldProceed: true };
    });
  }

  /**
   * Update generation with API details and parsed AI response.
   * @param {string} generationId - Generation ID
   * @param {Object} details - Generation details
   * @param {Object} [details.apiRequest] - API request data
   * @param {Object} [details.apiResponse] - API response data
   * @param {Array<string>} [details.messageIds] - IDs of messages used in generation
   * @param {string[]} [details.responseMessages] - AI가 생성한 메시지 배열
   * @param {Object} [details.emotionDelta] - 감정 변화량 object
   * @param {string} [details.emotionReason] - emotion shift reason
   * @returns {Promise<Object>}
   */
  async updateDetails(generationId, details) {
    const {
      apiRequest,
      apiResponse,
      messageIds,
      responseMessages,
      emotionDelta,
      emotionReason,
    } = details;

    return await prisma.generation.update({
      where: { id: generationId },
      data: {
        apiRequestJson: apiRequest ? JSON.stringify(apiRequest) : undefined,
        apiResponseJson: apiResponse ? JSON.stringify(apiResponse) : undefined,
        messageIdsJson: messageIds ? JSON.stringify(messageIds) : undefined,
        responseMessagesJson: responseMessages
          ? JSON.stringify(responseMessages)
          : undefined,
        emotionDeltaJson: emotionDelta
          ? JSON.stringify(emotionDelta)
          : undefined,
        emotionReason: emotionReason ?? undefined,
      },
    });
  }

  /**
   * Updates the messages array for a specific generation by appending new message IDs.
   * Retrieves the existing generation, parses its messagesJson field, merges it with new message IDs,
   * and updates the generation record with the combined array.
   *
   * @async
   * @param {string|number} generationId - The unique identifier of the generation to update
   * @param {string|number} messageId - Message ID to append to the existing messages
   * @returns {Promise<Object>} The updated generation object from the database
   * @throws {Error} If the database operation fails
   */
  async appendMessage(generationId, messageId) {
    const generation = await prisma.generation.findUnique({
      where: { id: generationId },
    });

    const existingMessages = generation?.messageIdsJson
      ? JSON.parse(generation.messageIdsJson)
      : [];

    const updatedMessages = [...existingMessages, messageId];

    return await prisma.generation.update({
      where: { id: generationId },
      data: {
        messageIdsJson: JSON.stringify(updatedMessages),
      },
    });
  }
}
