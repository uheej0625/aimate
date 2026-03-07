/**
 * RelationshipEngine
 *
 * 유저별 관계 수치(affinity, trust, affection)의 delta 적용, 클램핑, 기본값을 관리한다.
 *
 * 관계 수치 범위: 0 ~ 100
 * 기본 초기값은 Prisma 스키마 default와 동일하게 유지한다.
 *   affinity (호감도) : 30
 *   trust    (신뢰도) : 30
 *   affection(애정도) : 20
 */

export const RELATIONSHIP_KEYS = ["affinity", "trust", "affection"];

/** 관계 수치의 최솟값 / 최댓값 */
export const RELATIONSHIP_MIN = 0;
export const RELATIONSHIP_MAX = 100;

/**
 * 단일 수치를 [RELATIONSHIP_MIN, RELATIONSHIP_MAX] 범위로 클램핑한다.
 * @param {number} value
 * @returns {number}
 */
export function clamp(value) {
  return Math.max(
    RELATIONSHIP_MIN,
    Math.min(RELATIONSHIP_MAX, Math.round(value)),
  );
}

/**
 * 현재 관계 상태에 delta를 적용하고 클램핑된 새 상태를 반환한다.
 *
 * @param {Object} current - 현재 User DB 레코드 (또는 부분 객체)
 * @param {Object} delta   - AI가 반환한 relationship_delta 객체
 * @returns {Object} 클램핑된 새 관계 수치 (RELATIONSHIP_KEYS만 포함)
 *
 * @example
 * const next = applyDelta(currentUser, { affinity: 3, trust: -2 });
 * // { affinity: 33, trust: 28, affection: 20 }
 */
export function applyDelta(current, delta) {
  const result = {};
  for (const key of RELATIONSHIP_KEYS) {
    const base =
      typeof current[key] === "number"
        ? current[key]
        : key === "affection"
          ? 20
          : 30;
    const d = typeof delta?.[key] === "number" ? delta[key] : 0;
    result[key] = clamp(base + d);
  }
  return result;
}

/**
 * 관계 상태 객체를 사람이 읽기 쉬운 문자열로 변환한다. (디버깅용)
 * @param {Object} state
 * @returns {string}
 */
export function formatState(state) {
  return RELATIONSHIP_KEYS.map((k) => `${k}:${state[k] ?? "?"}`).join(", ");
}
