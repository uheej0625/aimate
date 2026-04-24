/**
 * ToolRegistry
 *
 * 모든 툴 정의를 관리하고, 실행 컨텍스트(platform, 자격증명)에 따라
 * 활성화된 툴 목록을 반환한다.
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
   * @param {Object}   toolDef.declaration - Google Cloud/OpenAI 함수 스키마
   * @param {Function} toolDef.execute     - async (args, context) => result
   */
  register(toolDef) {
    if (!toolDef.name) throw new Error("Tool must have a name");
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
      const credentialsOk = tool.requires.every((service) =>
        this.configManager.has(`secrets.${service}ApiKey`),
      );
      if (!credentialsOk) return false;

      return true;
    });
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
