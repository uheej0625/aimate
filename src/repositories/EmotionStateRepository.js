import { prisma } from "../database/client.js";
import { applyDelta, EMOTION_KEYS } from "../engines/emotion/EmotionEngine.js";

/**
 * EmotionState의 scopeKey 생성 헬퍼
 */
export const ScopeKey = {
  global: () => "global",
  server: (serverId) => `server:${serverId}`,
  channel: (channelId) => `channel:${channelId}`,
};

/**
 * Repository for EmotionState database operations.
 *
 * 스코프별 감정 상태를 CRUD한다.
 * - GLOBAL  : 전역 (serveId / channelId 없음)
 * - SERVER  : 서버별
 * - CHANNEL : 채널별
 */
export class EmotionStateRepository {
  /**
   * scopeKey로 감정 상태를 조회한다. 없으면 null 반환.
   * @param {string} scopeKey
   * @returns {Promise<Object|null>}
   */
  async findByScopeKey(scopeKey) {
    return await prisma.emotionState.findUnique({ where: { scopeKey } });
  }

  /**
   * 전역 감정 상태를 가져온다. 없으면 기본값으로 생성 후 반환.
   * @returns {Promise<Object>}
   */
  async getGlobal() {
    return await this._upsertEmpty(ScopeKey.global(), "GLOBAL", {});
  }

  /**
   * 서버 감정 상태를 가져온다. 없으면 기본값으로 생성 후 반환.
   * @param {string} serverId - 내부 Server.id
   * @returns {Promise<Object>}
   */
  async getForServer(serverId) {
    return await this._upsertEmpty(ScopeKey.server(serverId), "SERVER", {
      serverId,
    });
  }

  /**
   * 채널 감정 상태를 가져온다. 없으면 기본값으로 생성 후 반환.
   * @param {string} channelId - 내부 Channel.id
   * @returns {Promise<Object>}
   */
  async getForChannel(channelId) {
    return await this._upsertEmpty(ScopeKey.channel(channelId), "CHANNEL", {
      channelId,
    });
  }

  /**
   * 감정 delta를 적용하고 저장한다. 해당 scopeKey가 없으면 기본값에서 시작.
   *
   * @param {string} scopeKey  - ScopeKey.global() 등으로 생성
   * @param {string} scope     - "GLOBAL" | "SERVER" | "CHANNEL"
   * @param {Object} delta     - AI emotion_delta 객체
   * @param {Object} [relations] - { serverId?, channelId? }
   * @returns {Promise<Object>} 업데이트된 EmotionState 레코드
   */
  async applyDelta(scopeKey, scope, delta, relations = {}) {
    // 현재 상태 조회 (없으면 기본값 생성)
    const current = await this._upsertEmpty(scopeKey, scope, relations);

    // delta 적용 + 클램핑
    const next = applyDelta(current, delta);

    return await prisma.emotionState.update({
      where: { scopeKey },
      data: next,
    });
  }

  /**
   * 특정 스코프의 감정 수치를 직접 설정한다 (override).
   *
   * @param {string} scopeKey
   * @param {Object} values - 설정할 감정 수치 (일부만 전달해도 됨)
   * @returns {Promise<Object>}
   */
  async setValues(scopeKey, values) {
    // EMOTION_KEYS만 허용
    const filtered = {};
    for (const key of EMOTION_KEYS) {
      if (typeof values[key] === "number") filtered[key] = values[key];
    }

    return await prisma.emotionState.update({
      where: { scopeKey },
      data: filtered,
    });
  }

  /**
   * 모든 EmotionState 레코드를 조회한다.
   * @returns {Promise<Object[]>}
   */
  async findAll() {
    return await prisma.emotionState.findMany({
      orderBy: { updatedAt: "desc" },
    });
  }

  // ─────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────

  /**
   * 레코드가 없으면 기본값으로 생성하고, 있으면 그대로 반환한다.
   * Prisma upsert를 활용해 레이스 컨디션을 방지한다.
   *
   * @param {string} scopeKey
   * @param {string} scope
   * @param {Object} relations - { serverId?, channelId? }
   * @returns {Promise<Object>}
   */
  async _upsertEmpty(scopeKey, scope, relations = {}) {
    return await prisma.emotionState.upsert({
      where: { scopeKey },
      update: {}, // 이미 존재하면 아무것도 바꾸지 않음
      create: {
        scopeKey,
        scope,
        ...(relations.serverId ? { serverId: relations.serverId } : {}),
        ...(relations.channelId ? { channelId: relations.channelId } : {}),
        // 감정 초기값은 Prisma schema default 사용
      },
    });
  }
}
