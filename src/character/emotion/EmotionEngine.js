/**
 * EmotionEngine
 *
 * 감정 상태(EmotionState)의 delta 적용, 클램핑, 기본값을 관리한다.
 *
 * 감정 수치 범위: 0 ~ 100
 * 기본 초기값은 Prisma 스키마 default와 동일하게 유지한다.
 */

export const EMOTION_KEYS = [
  "attachment",
  "jealousy",
  "trust",
  "awe",
  "anxiety",
  "possessiveness",
  "self_worth",
];

/** 감정 수치의 최솟값 / 최댓값 */
export const EMOTION_MIN = 0;
export const EMOTION_MAX = 100;

/**
 * 단일 수치를 [EMOTION_MIN, EMOTION_MAX] 범위로 클램핑한다.
 * @param {number} value
 * @returns {number}
 */
export function clamp(value) {
  return Math.max(EMOTION_MIN, Math.min(EMOTION_MAX, Math.round(value)));
}

/**
 * 현재 감정 상태에 delta를 적용하고 클램핑된 새 상태를 반환한다.
 *
 * @param {Object} current - 현재 EmotionState DB 레코드 (또는 부분 객체)
 * @param {Object} delta   - AI가 반환한 emotion_delta 객체
 * @returns {Object} 클램핑된 새 감정 수치 (EMOTION_KEYS만 포함)
 *
 * @example
 * const next = EmotionEngine.applyDelta(currentState, { attachment: 5, anxiety: -10 });
 * // { attachment: 55, jealousy: 0, trust: 50, awe: 0, anxiety: 10, possessiveness: 0, self_worth: 60 }
 */
export function applyDelta(current, delta) {
  const result = {};
  for (const key of EMOTION_KEYS) {
    const base = typeof current[key] === "number" ? current[key] : 0;
    const d = typeof delta?.[key] === "number" ? delta[key] : 0;
    result[key] = clamp(base + d);
  }
  return result;
}

/**
 * 감정 상태 객체를 사람이 읽기 쉬운 문자열로 변환한다. (디버깅용)
 * @param {Object} state
 * @returns {string}
 */
export function formatState(state) {
  return EMOTION_KEYS.map((k) => `${k}:${state[k] ?? "?"}`).join(", ");
}
