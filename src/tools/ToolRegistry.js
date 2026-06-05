import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { tool } from "ai";
import { createLogger } from "../core/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createLogger("ToolRegistry");

/**
 * ToolRegistry
 *
 * 모든 툴 정의를 관리하고, 실행 컨텍스트(platform, 자격증명)에 따라
 * AI SDK ToolSet을 만든다.
 *
 * 툴 필터링 조건 (AND):
 *   1. tool.enabled === true
 *   2. tool.platforms 에 현재 platform 포함 (또는 '*')
 *   3. tool.requires 의 모든 서비스에 대한 API Key가 config에 존재
 */
export class ToolRegistry {
  /**
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(configManager) {
    this.configManager = configManager;
    /** @type {Map<string, Object>} name → tool definition */
    this.tools = new Map();
  }

  /**
   * 툴 정의를 등록한다.
   * @param {Object} toolDef
   * @param {string}   toolDef.name        - 툴 이름 (LLM에 노출되는 식별자)
   * @param {boolean}  toolDef.enabled     - false 이면 항상 비활성화
   * @param {string[]} toolDef.platforms   - '*' 또는 플랫폼 ID 배열 ('discord', 'telegram', 'cli', …)
   * @param {string[]} toolDef.requires    - 필요한 서비스 키 배열 ('novelai', 'openai', …)
   * @param {string}   toolDef.description - 모델에 노출되는 툴 설명
   * @param {Object}   toolDef.inputSchema - AI SDK inputSchema
   * @param {Function} toolDef.execute     - async (args, context) => result
   */
  register(toolDef) {
    if (!toolDef || !toolDef.name) throw new Error("Tool must have a name");
    if (typeof toolDef.execute !== "function") {
      throw new Error(`Tool ${toolDef.name} must have an execute function`);
    }
    if (!toolDef.description) {
      throw new Error(`Tool ${toolDef.name} must have a description`);
    }
    if (!toolDef.inputSchema) {
      throw new Error(`Tool ${toolDef.name} must have an inputSchema`);
    }
    if (this.tools.has(toolDef.name)) {
      throw new Error(`Duplicate tool definition for: ${toolDef.name}`);
    }
    this.tools.set(toolDef.name, {
      platforms: ["*"],
      requires: [],
      enabled: true,
      ...toolDef,
    });
  }

  /**
   * 여러 툴을 한번에 등록한다.
   * @param {Object[]} toolDefs
   */
  registerAll(toolDefs) {
    for (const def of toolDefs) {
      this.register(def);
    }
  }

  /**
   * 디렉토리에서 툴들을 동적으로 불러온다.
   * @param {string} dirPath - 툴 모듈들이 있는 디렉토리 절대 경로 (기본값: 현재 디렉토리/definitions)
   */
  async loadFromDirectory(dirPath = path.join(__dirname, "definitions")) {
    try {
      const files = await fs.readdir(dirPath);
      const jsFiles = files.filter((f) => f.endsWith(".js"));
      jsFiles.sort();

      for (const file of jsFiles) {
        const filePath = path.join(dirPath, file);

        try {
          const module = await import(pathToFileURL(filePath).href);
          const toolDef = module.default;
          if (toolDef) {
            this.register(toolDef);
          }
        } catch (err) {
          console.error(`Failed to load tool from ${file}:`, err);
        }
      }
    } catch (err) {
      console.error(`Failed to read tool directory ${dirPath}:`, err);
    }
  }

  /**
   * 현재 실행 컨텍스트에서 사용 가능한 툴 목록을 반환한다.
   * @param {string} platform - 현재 대화 플랫폼 ('discord', 'telegram', 'cli', …)
   * @returns {Object[]} 활성화된 툴 정의 배열
   */
  getActiveTools(platform) {
    return [...this.tools.values()].filter((tool) => {
      // 1. enabled 체크
      if (!tool.enabled) return false;

      // 2. 플랫폼 체크
      const platformOk =
        tool.platforms.includes("*") || tool.platforms.includes(platform);
      if (!platformOk) return false;

      // 3. 자격증명 체크
      const credentialsOk = tool.requires.every((service) => {
        if (service === "image") {
          return !!this.configManager.get("ai.image.model");
        }

        const key = `secrets.${service}ApiKey`;
        return this.configManager.has(key) && !!this.configManager.get(key);
      });
      if (!credentialsOk) return false;

      return true;
    });
  }

  createToolSet(platform, context) {
    return Object.fromEntries(
      this.getActiveTools(platform).map((toolDef) => [
        toolDef.name,
        tool({
          description: toolDef.description,
          inputSchema: toolDef.inputSchema,
          execute: async (input, options = {}) => {
            try {
              const result = await toolDef.execute(input ?? {}, {
                ...context,
                toolCallId: options.toolCallId,
                messages: options.messages,
                abortSignal: options.abortSignal,
              });

              logger.info(
                { tool: toolDef.name, input, result },
                "Tool executed",
              );
              return result;
            } catch (error) {
              logger.error(
                { err: error, toolName: toolDef.name },
                "Tool execution error",
              );
              return { error: error.message };
            }
          },
        }),
      ]),
    );
  }

  /**
   * 이름으로 툴을 조회한다 (실행 시 사용).
   * @param {string} name
   * @returns {Object|undefined}
   */
  getTool(name) {
    return this.tools.get(name);
  }
}
