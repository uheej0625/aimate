import { prisma } from "../database/client.js";
import { getRequiredCharacterId } from "../character/config.js";

/**
 * Repository for Generation database operations.
 * Handles AI generation tracking and status management.
 */
export class GenerationRepository {
  /**
   * @param {import('../config/ConfigManager.js').default} [configManager]
   */
  constructor(configManager = null) {
    this.characterId = configManager
      ? getRequiredCharacterId(configManager)
      : null;
  }

  /**
   * Create a new generation record.
   * @param {Object} generationData - Generation data
   * @returns {Promise<Object>} The created generation record
   */
  async create(generationData) {
    const {
      channelId,
      type = "CHAT",
      prompt,
      input,
      status = "PENDING",
      characterId = this.characterId,
    } = generationData;

    return await prisma.generation.create({
      data: {
        channelId,
        type,
        prompt,
        input,
        status,
        characterId,
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
   * @param {string} [type="CHAT"] - Generation type to cancel
   * @returns {Promise<number>} Number of cancelled generations
   */
  async cancelProcessing(channelId, type = "CHAT") {
    const result = await prisma.generation.updateMany({
      where: {
        channelId,
        type,
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
   * Find the latest completed image generation by its output filename.
   * @param {string} filename - Generated image filename, e.g. "21dc101b.png"
   * @returns {Promise<Object|null>}
   */
  async findCompletedImageByOutput(filename) {
    return await prisma.generation.findFirst({
      where: {
        type: "IMAGE",
        status: "COMPLETED",
        output: filename,
      },
      orderBy: { createdAt: "desc" },
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
   * Update generation with API details and parsed response.
   * @param {string} generationId - Generation ID
   * @param {Object} details - Generation details
   * @param {Object} [details.apiRequest] - API request data
   * @param {Object} [details.apiResponse] - API response data
   * @param {string} [details.input] - Input (prompt or JSON msg IDs)
   * @param {string} [details.output] - Output (file path or JSON msg array)
   * @param {Object} [details.metadata] - Optional domain-specific metadata
   * @returns {Promise<Object>}
   */
  async updateDetails(generationId, details) {
    const { apiRequest, apiResponse, input, output, metadata } = details;

    return await prisma.generation.update({
      where: { id: generationId },
      data: {
        apiRequest: apiRequest ? JSON.stringify(apiRequest) : undefined,
        apiResponse: apiResponse ? JSON.stringify(apiResponse) : undefined,
        input,
        output,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    });
  }
}
