import fs from "fs/promises";
import path from "path";
import { createLogger } from "../core/logger.js";
import { renderTemplate } from "../utils/renderTemplate.js";

const logger = createLogger("CharacterLoader");

/**
 * CharacterLoader - 캐릭터 프로필과 동적 변수를 로드하고 템플릿을 렌더링
 */
export class CharacterLoader {
  /**
   * @param {string} identityPath - identity.md 파일 경로
   * @param {string} variablesPath - variables.json 파일 경로
   */
  constructor(
    identityPath = "content/character/identity.md",
    variablesPath = "content/character/variables.json",
  ) {
    this.identityPath = path.join(process.cwd(), identityPath);
    this.variablesPath = path.join(process.cwd(), variablesPath);
    this._cachedResult = null;
  }

  /**
   * 캐릭터 정보를 로드하고 동적 변수를 치환하여 반환
   * @returns {Promise<string>} 최종 캐릭터 텍스트
   */
  async load() {
    if (this._cachedResult) {
      return this._cachedResult;
    }

    // identity.md 템플릿 로드
    const template = await fs.readFile(this.identityPath, "utf-8");

    // variables.json 로드
    let variables = {};
    try {
      const variablesContent = await fs.readFile(this.variablesPath, "utf-8");
      variables = JSON.parse(variablesContent);
    } catch (error) {
      logger.warn({ err: error }, "variables.json을 찾을 수 없거나 파싱 실패");
    }

    // 동적 컨텍스트 준비
    const context = this._buildContext(variables);

    this._cachedResult = renderTemplate(template, context);
    return this._cachedResult;
  }

  /**
   * 템플릿 렌더링에 사용할 컨텍스트 객체 생성
   * @param {Object} variables - variables.json의 내용
   * @returns {Object} 평가 가능한 컨텍스트
   */
  _buildContext(variables) {
    const now = new Date();
    const birthday = variables.birthday;
    const schoolEnrollment = variables.schoolEnrollment || { year: 2025 };

    // 미리 계산된 값들
    const age = CharacterLoader.calculateAge(birthday, now);
    const grade = CharacterLoader.calculateGrade(schoolEnrollment.year, now);

    return {
      today: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
      },
      birthday,
      schoolEnrollment,
      age, // 계산된 나이
      grade, // 계산된 학년
      // 필요시 추가 변수들...
    };
  }

  /**
   * 나이 계산 헬퍼 (생년월일 기준)
   * @param {Object} birthday - {year, month, day}
   * @param {Date} referenceDate - 기준 날짜 (기본: 오늘)
   * @returns {number} 만 나이
   */
  static calculateAge(birthday, referenceDate = new Date()) {
    const birthDate = new Date(birthday.year, birthday.month - 1, birthday.day);
    let age = referenceDate.getFullYear() - birthDate.getFullYear();
    const monthDiff = referenceDate.getMonth() - birthDate.getMonth();

    // 생일이 안 지났으면 -1
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && referenceDate.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }

  /**
   * 학년 계산 헬퍼
   * @param {number} enrollmentYear - 입학 연도
   * @param {Date} referenceDate - 기준 날짜
   * @returns {number} 학년 (1-3)
   */
  static calculateGrade(enrollmentYear, referenceDate = new Date()) {
    const currentYear = referenceDate.getFullYear();
    const currentMonth = referenceDate.getMonth() + 1;

    // 3월 이전이면 전년도 학년 유지
    const academicYear = currentMonth < 3 ? currentYear - 1 : currentYear;

    const grade = academicYear - enrollmentYear + 1;
    return Math.max(1, Math.min(3, grade)); // 1-3 사이로 제한
  }
}
