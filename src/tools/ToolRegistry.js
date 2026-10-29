import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { tool } from "ai";
import { createLogger, elapsedMs, withLogContext } from "../core/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createLogger("ToolRegistry");

/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {boolean} [enabled]
 * @property {string[]} [platforms]
 * @property {string[]} [requires]
 * @property {string} description
 * @property {Object} inputSchema
 * @property {(input: Object, context: Object) => Promise<unknown>} execute
 */

/**
 * ToolRegistry
 *
 * 모든 툴 정의를 관리하고, 실행 컨텍스트(platform, 자격증명)에 따라
 * AI SDK ToolSet을 만든다.
 *
 * 툴 필터링 조건 (AND):
 *   1. tool.enabled === true
 *   2. tool.platforms 에 현재 platform 포함 (또는 '*')
 *   3. tool.requires 의 기능이 설정되어 있음 (현재 'image'만 지원)
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
   * @param {string[]} toolDef.requires    - 필요한 기능 배열 (현재 'image'만 지원)
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
          logger.error(
            { event: "tools.load.failed", file, err },
            "Tool module failed to load",
          );
        }
      }
    } catch (err) {
      logger.error(
        { event: "tools.directory.failed", directory: dirPath, err },
        "Tool directory failed to load",
      );
    }
    logger.info(
      { event: "tools.loaded", toolCount: this.tools.size },
      "Application tools loaded",
    );
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

      // 인증 검증은 provider 경계에서 수행하며 도구에는 인증 값을 전달하지 않는다.
      const capabilitiesOk = tool.requires.every(
        (service) =>
          service === "image" && !!this.configManager.get("ai.image.model"),
      );
      if (!capabilitiesOk) return false;

      return true;
    });
  }

  createToolSet(platform, context) {
    const activeTools = this.getActiveTools(platform);
    logger.debug(
      {
        event: "tools.selected",
        platform,
        toolNames: activeTools.map((tool) => tool.name),
      },
      "Application tools selected",
    );
    return Object.fromEntries(
      activeTools.map((toolDef) => [
        toolDef.name,
        tool({
          description: toolDef.description,
          inputSchema: toolDef.inputSchema,
          execute: async (input, options = {}) => {
            const abortSignal = options.abortSignal ?? context?.abortSignal;
            return withLogContext(
              {
                platform,
                channelId: context?.channel?.id,
                generationId: context?.generationId,
                toolName: toolDef.name,
                toolCallId: options.toolCallId,
              },
              async () => {
                const startedAt = performance.now();
                logger.info(
                  { event: "tool.started" },
                  "Application tool started",
                );
                try {
                  const result = await toolDef.execute(input ?? {}, {
                    ...context,
                    toolCallId: options.toolCallId,
                    messages: options.messages,
                    abortSignal,
                  });

                  const cancelled = abortSignal?.aborted;
                  const failed =
                    result?.error != null ||
                    result?.success === false ||
                    result?.status === "error" ||
                    result?.status === "failed";
                  logger[cancelled ? "debug" : failed ? "warn" : "info"](
                    {
                      event: cancelled
                        ? "tool.cancelled"
                        : failed
                          ? "tool.failed"
                          : "tool.completed",
                      outcome: cancelled
                        ? "cancelled"
                        : failed
                          ? "failed"
                          : "success",
                      durationMs: elapsedMs(startedAt),
                      reason: failed
                        ? result?.error != null
                          ? "returned_error"
                          : "reported_failure"
                        : undefined,
                    },
                    "Application tool finished",
                  );
                  return result;
                } catch (error) {
                  const cancelled =
                    abortSignal?.aborted || error.name === "AbortError";
                  logger[cancelled ? "debug" : "error"](
                    {
                      event: cancelled ? "tool.cancelled" : "tool.failed",
                      err: error,
                      durationMs: elapsedMs(startedAt),
                    },
                    "Application tool execution stopped",
                  );
                  return { error: error.message };
                }
              },
            );
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
