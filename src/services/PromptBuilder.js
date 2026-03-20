import { EMOTION_KEYS } from "../engines/emotion/EmotionEngine.js";
import { RELATIONSHIP_KEYS } from "../engines/relationship/RelationshipEngine.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("PromptBuilder");

/**
 * 시스템 프롬프트 템플릿의 변수를 실제 값으로 치환한다.
 *
 * 치환 대상:
 *   {character}         - 캐릭터 마크다운 파일 내용
 *   {emotionalState}    - 채널 스코프 감정 수치 (없으면 기본값)
 *   {relationshipState} - 유저별 관계 수치 (없으면 기본값)
 *   {currentTime}       - 현재 시각 (로컬)
 */
export class PromptBuilder {
  /**
   * @param {import('../loaders/CharacterLoader.js').CharacterLoader} characterLoader
   * @param {import('../repositories/EmotionStateRepository.js').EmotionStateRepository} [emotionStateRepository]
   */
  constructor(characterLoader, emotionStateRepository = null) {
    this.characterLoader = characterLoader;
    this.emotionStateRepository = emotionStateRepository;
  }

  /**
   * 시스템 프롬프트를 빌드한다.
   *
   * @param {string} template - 시스템 프롬프트 템플릿
   * @param {Object|null} channelRecord - 내부 Channel 레코드 (감정 상태 스코프 결정용)
   * @param {Object|null} userRecord - 현재 유저의 User 레코드 (관계 수치용)
   * @returns {Promise<string>}
   */
  async build(template, channelRecord = null, userRecord = null) {
    const character = await this.characterLoader.load();
    const emotionalState = await this._resolveEmotionalState(channelRecord);
    const relationshipState = this._resolveRelationshipState(userRecord);
    const currentTime = new Date().toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
    });

    return template
      .replace("{character}", character)
      .replace("{emotionalState}", emotionalState)
      .replace("{relationshipState}", relationshipState)
      .replace("{currentTime}", currentTime);
  }

  /**
   * channelRecord.scope 기준으로 감정 상태 문자열을 반환한다.
   * @param {Object|null} channelRecord
   * @returns {Promise<string>}
   */
  async _resolveEmotionalState(channelRecord) {
    const fallback = EMOTION_KEYS.map((k) => `${k}: 50`).join("\n");

    if (!this.emotionStateRepository || !channelRecord?.id) return fallback;

    try {
      const scope = channelRecord.scope ?? "channel";
      let state;
      if (scope === "global") {
        state = await this.emotionStateRepository.getGlobal();
      } else if (scope === "server" && channelRecord.serverId) {
        state = await this.emotionStateRepository.getForServer(
          channelRecord.serverId,
        );
      } else {
        state = await this.emotionStateRepository.getForChannel(
          channelRecord.id,
        );
      }
      return EMOTION_KEYS.map((k) => `${k}: ${state[k]}`).join("\n");
    } catch (e) {
      logger.warn({ err: e }, "Failed to load emotion state");
      return fallback;
    }
  }

  /**
   * userRecord에서 관계 수치 문자열을 반환한다.
   * @param {Object|null} userRecord
   * @returns {string}
   */
  _resolveRelationshipState(userRecord) {
    const defaults = { affinity: 30, trust: 30, affection: 20 };
    return RELATIONSHIP_KEYS.map((k) => {
      const v = userRecord?.[k];
      return `${k}: ${typeof v === "number" ? v : defaults[k]}`;
    }).join("\n");
  }
}
