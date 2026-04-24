import { createLogger } from "../core/logger.js";

const logger = createLogger("ToolExecutor");

/**
 * ToolExecutor
 *
 * 툴 호출 요청을 받아 실제 execute() 함수를 실행하고 결과를 반환한다.
 *
 * execute()에 주입되는 context 객체:
 *   - platform        : 현재 플랫폼 ID
 *   - platformClients : Map<platform, client> — 플랫폼별 클라이언트
 *   - configManager   : ConfigManager 인스턴스
 *   - cronService     : CronService 인스턴스 (선택)
 *   - channel         : Channel 레코드 (선택)
 */
export class ToolExecutor {
  /**
   * @param {import('./ToolRegistry.js').ToolRegistry} toolRegistry
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {Map<string, any>} platformClients  platform ID → 클라이언트 인스턴스
   * @param {import('../services/CronService.js').CronService} [cronService]  CronService 인스턴스 (선택)
   */
  constructor(
    toolRegistry,
    configManager,
    platformClients = new Map(),
    cronService = null,
  ) {
    this.toolRegistry = toolRegistry;
    this.configManager = configManager;
    this.platformClients = platformClients;
    this.cronService = cronService;
  }

  /**
   * 단일 툴 호출을 실행한다.
   * @param {{ name: string, args: Object }} toolCall
   * @param {string} platform
   * @param {Object} [channelRecord] - 내부 Channel 레코드 (선택)
   * @param {Object} [aiService] - AI 서비스 컨텍스트 (선택)
   * @returns {Promise<any>} 툴 실행 결과
   */
  async execute(toolCall, platform, channelRecord = null, aiService = null) {
    const tool = this.toolRegistry.getTool(toolCall.name);

    if (!tool) {
      const msg = `Unknown tool: "${toolCall.name}"`;
      logger.error({ toolName: toolCall.name }, "Unknown tool");
      return { error: msg };
    }

    const context = {
      platform,
      platformClient: this.platformClients.get(platform) ?? null,
      platformClients: this.platformClients,
      configManager: this.configManager,
      cronService: this.cronService,
      channel: channelRecord,
      aiService,
    };

    try {
      const result = await tool.execute(toolCall.args ?? {}, context);
      logger.info(
        { tool: toolCall.name, args: toolCall.args, result },
        "Tool executed",
      );
      return result;
    } catch (err) {
      logger.error({ err, toolName: toolCall.name }, "Tool execution error");
      return { error: err.message };
    }
  }

  /**
   * 복수의 툴 호출을 병렬로 실행한다.
   * @param {{ name: string, args: Object }[]} toolCalls
   * @param {string} platform
   * @param {Object} [channelRecord] - 내부 Channel 레코드 (선택)
   * @param {Object} [aiService] - AI 서비스 컨텍스트 (선택)
   * @returns {Promise<any[]>} 순서를 보존한 결과 배열
   */
  async executeAll(
    toolCalls,
    platform,
    channelRecord = null,
    aiService = null,
  ) {
    return Promise.all(
      toolCalls.map((tc) =>
        this.execute(tc, platform, channelRecord, aiService),
      ),
    );
  }
}
