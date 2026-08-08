import fs from "fs/promises";
import path from "path";
import { createLogger } from "../core/logger.js";
import { buildSystemContext, renderTemplate } from "../utils/renderTemplate.js";
import { resolveCharacterFile } from "./config.js";

const logger = createLogger("CharacterContextBuilder");

export class CharacterContextBuilder {
  /**
   * @param {Object} [options]
   * @param {import('../config/ConfigManager.js').default} [options.configManager]
   * @param {string} [options.identityPath]
   * @param {string} [options.variablesPath]
   */
  constructor(options = {}) {
    const identityPath =
      options.identityPath ??
      (options.configManager
        ? resolveCharacterFile(options.configManager, "identity.md")
        : "content/characters/default/identity.md");
    const variablesPath =
      options.variablesPath ??
      (options.configManager
        ? resolveCharacterFile(options.configManager, "variables.json")
        : "content/characters/default/variables.json");

    this.identityPath = path.resolve(process.cwd(), identityPath);
    this.variablesPath = path.resolve(process.cwd(), variablesPath);
  }

  /**
   * @param {Object} [options]
   * @param {Object} [options.system]
   * @returns {Promise<Object>}
   */
  async build({ system = buildSystemContext() } = {}) {
    const variables = await this.loadVariables();
    const character = this.buildCharacterData(variables, system);
    const identity = await this.renderIdentity(character, system);

    return {
      ...character,
      identity,
    };
  }

  /**
   * @returns {Promise<Object>}
   */
  async loadVariables() {
    try {
      const content = await fs.readFile(this.variablesPath, "utf-8");
      return JSON.parse(content);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;

      logger.warn(
        { err: e, filePath: this.variablesPath },
        "Character variables file not found; continuing without variables",
      );
      return {};
    }
  }

  /**
   * @param {Object} variables
   * @param {Object} system
   * @returns {Object}
   */
  buildCharacterData(variables, system) {
    const now = new Date(system.now.raw);
    const birthday = variables.birthday ?? null;
    const schoolEnrollment = variables.schoolEnrollment ?? null;
    const timezone = variables.timezone ?? undefined;
    const age = birthday
      ? CharacterContextBuilder.calculateAge(birthday, now, timezone)
      : undefined;
    const schoolGrade = schoolEnrollment?.year
      ? CharacterContextBuilder.calculateGrade(
          schoolEnrollment.year,
          now,
          timezone,
        )
      : undefined;

    return {
      ...variables,
      birthday,
      birthDate: birthday
        ? CharacterContextBuilder.formatBirthDate(birthday)
        : "",
      schoolEnrollment,
      age,
      schoolGrade,
    };
  }

  /**
   * @param {Object} character
   * @param {Object} system
   * @returns {Promise<string>}
   */
  async renderIdentity(character, system) {
    const template = await fs.readFile(this.identityPath, "utf-8");
    return renderTemplate(template, {
      character,
      system,
    });
  }

  /**
   * @param {{year: number, month: number, day: number}} birthday
   * @param {Date} [referenceDate]
   * @param {string} [timeZone]
   * @returns {number}
   */
  static calculateAge(birthday, referenceDate = new Date(), timeZone) {
    const today = CharacterContextBuilder.getDateParts(referenceDate, timeZone);
    let age = today.year - birthday.year;

    if (
      today.month < birthday.month ||
      (today.month === birthday.month && today.day < birthday.day)
    ) {
      age--;
    }

    return age;
  }

  /**
   * @param {number} enrollmentYear
   * @param {Date} [referenceDate]
   * @param {string} [timeZone]
   * @returns {number}
   */
  static calculateGrade(enrollmentYear, referenceDate = new Date(), timeZone) {
    const today = CharacterContextBuilder.getDateParts(referenceDate, timeZone);
    const academicYear = today.month < 3 ? today.year - 1 : today.year;
    const grade = academicYear - enrollmentYear + 1;

    return Math.max(1, Math.min(3, grade));
  }

  /**
   * @param {Date} date
   * @param {string} [timeZone]
   * @returns {{year: number, month: number, day: number}}
   */
  static getDateParts(date, timeZone) {
    if (!timeZone) {
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
      };
    }

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(date);

    return {
      year: Number(parts.find((part) => part.type === "year")?.value),
      month: Number(parts.find((part) => part.type === "month")?.value),
      day: Number(parts.find((part) => part.type === "day")?.value),
    };
  }

  /**
   * @param {{year: number, month: number, day: number}} birthday
   * @returns {string}
   */
  static formatBirthDate(birthday) {
    return `${birthday.year}년 ${birthday.month}월 ${birthday.day}일`;
  }
}
