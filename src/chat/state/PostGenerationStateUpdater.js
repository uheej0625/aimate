import { ScopeKey } from "../../repositories/EmotionStateRepository.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("PostGenerationStateUpdater");

function hasDelta(delta) {
  return delta && Object.keys(delta).length > 0;
}

/**
 * Applies domain state changes derived from a completed chat generation.
 */
export class PostGenerationStateUpdater {
  /**
   * @param {import('../../repositories/EmotionStateRepository.js').EmotionStateRepository} emotionStateRepository
   * @param {import('../../repositories/UserRepository.js').UserRepository|null} [userRepository]
   */
  constructor(emotionStateRepository, userRepository = null) {
    this.emotionStateRepository = emotionStateRepository;
    this.userRepository = userRepository;
  }

  /**
   * @param {Object} params
   * @param {Object} params.aiResult
   * @param {Object} params.channelRecord
   * @param {string|null} params.currentUserId
   */
  async apply({ aiResult, channelRecord, currentUserId }) {
    await this.applyEmotionDelta(aiResult, channelRecord);
    await this.applyRelationshipDelta(aiResult, currentUserId);
  }

  async applyEmotionDelta(aiResult, channelRecord) {
    if (!hasDelta(aiResult?.emotionDelta)) return;

    const delta = aiResult.emotionDelta;
    const scope = channelRecord.scope ?? "channel";

    if (scope === "global") {
      await this.emotionStateRepository.applyDelta(
        ScopeKey.global(),
        "GLOBAL",
        delta,
      );
    } else if (scope === "server" && channelRecord.serverId) {
      await this.emotionStateRepository.applyDelta(
        ScopeKey.server(channelRecord.serverId),
        "SERVER",
        delta,
        { serverId: channelRecord.serverId },
      );
    } else {
      await this.emotionStateRepository.applyDelta(
        ScopeKey.channel(channelRecord.id),
        "CHANNEL",
        delta,
        { channelId: channelRecord.id },
      );
    }

    logger.info(
      { scope, reason: aiResult.emotionReason },
      "Emotion delta applied",
    );
  }

  async applyRelationshipDelta(aiResult, currentUserId) {
    if (
      !currentUserId ||
      !this.userRepository ||
      !hasDelta(aiResult?.relationshipDelta)
    ) {
      return;
    }

    await this.userRepository.applyRelationshipDelta(
      currentUserId,
      aiResult.relationshipDelta,
    );
    logger.info({ userId: currentUserId }, "Relationship delta applied");
  }
}
