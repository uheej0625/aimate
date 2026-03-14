import fs from "fs/promises";
import path from "path";
import { GeminiProvider } from "../providers/GeminiProvider.js";
import { VertexProvider } from "../providers/VertexProvider.js";
import { ScopeKey } from "../repositories/EmotionStateRepository.js";
import { CharacterLoader } from "../loaders/CharacterLoader.js";
import { PromptBuilder } from "./PromptBuilder.js";

export class AIService {
  /**
   * @param {import('../services/ContextService.js').ContextService} contextService
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {import('../tools/ToolRegistry.js').ToolRegistry} [toolRegistry]
   * @param {import('../tools/ToolExecutor.js').ToolExecutor} [toolExecutor]
   * @param {import('./PromptBuilder.js').PromptBuilder} [promptBuilder]
   * @param {import('../repositories/UserRepository.js').UserRepository} [userRepository]
   */
  constructor(
    contextService,
    configManager,
    toolRegistry = null,
    toolExecutor = null,
    promptBuilder = null,
    userRepository = null,
  ) {
    this.configManager = configManager;
    this.contextService = contextService;
    this.toolRegistry = toolRegistry;
    this.toolExecutor = toolExecutor;
    this.promptBuilder =
      promptBuilder ?? new PromptBuilder(new CharacterLoader());
    this.userRepository = userRepository;

    this.chatModel = this.createModel("chat");
    //this.summaryModel = this.createModel("summary");
    //this.embeddingModel = this.createModel("embedding");

    this.systemInstruction = null;
  }

  /**
   * Prepare the context and system instruction for a reply.
   * @param {string} channelId - Internal channel ID
   * @param {string} botId
   * @param {Object} [channelRecord] - 내부 Channel 레코드 (emotion state 조회용)
   * @param {string} [cronMessage] - Cron job에서 전달되는 시스템 메시지 (선택)
   * @returns {Promise<{context: Array, systemInstruction: string, messageIds: Array, currentUserId: string|null}>}
   */
  async prepareContext(
    channelId,
    botId,
    channelRecord = null,
    cronMessage = null,
  ) {
    // 1. DB에서 히스토리 로드 (단일 쿼리)
    const { history, messageIds, lastUserPlatformAccountId } =
      await this.contextService.fetchHistoryData(channelId, botId);

    // 2. 마지막 유저의 관계 상태 조회
    let currentUserId = null;
    let userRecord = null;
    if (this.userRepository && lastUserPlatformAccountId) {
      try {
        const user = await this.userRepository.findByPlatformAccountId(
          lastUserPlatformAccountId,
        );
        if (user) {
          currentUserId = user.id;
          userRecord = user;
        }
      } catch (e) {
        console.warn(
          "[AIService] Failed to load relationship state:",
          e.message,
        );
      }
    }

    // 3. 시스템 인스트럭션 빌드
    const sysTemplate = await this.loadSystemInstruction();
    const systemInstruction = await this.promptBuilder.build(
      sysTemplate,
      channelRecord,
      userRecord,
    );

    // 4. 실험 프롬프트 part1(변수 치환), part2(정적) 로드
    const { part1Template, part2Template } = await this.loadContextParts();
    const part1 = await this.promptBuilder.build(
      part1Template,
      channelRecord,
      userRecord,
    );

    // 5. 컨텍스트 조립: [part1] → [히스토리] → [cronMessage?] → [part2]
    const context = this.contextService.assembleContext(
      history,
      botId,
      cronMessage,
      part1,
      part2Template,
    );

    return { context, systemInstruction, messageIds, currentUserId };
  }

  /**
   * AI 응답을 생성하고 파싱된 결과를 반환한다.
   *
   * AI는 다음 JSON 형식으로 응답한다:
   * {
   *   "messages": ["msg1", "msg2", ...],
   *   "emotion_delta": { "attachment": 0, ... },
   *   "emotion_reason": "..."
   * }
   *
   * Tools가 활성화된 경우 agentic loop를 실행한다:
   *   1. AI 호출 → tool_call 이벤트 감지
   *   2. 툴 실행 후 결과를 ephemeral context에 추가
   *   3. 다시 AI 호출 (최대 tools.maxSteps회)
   *   4. 최종 텍스트 응답을 JSON으로 파싱 후 반환
   *
   * @param {Array}  context           - DB에서 로드한 대화 컨텍스트
   * @param {string} systemInstruction - 시스템 프롬프트
   * @param {string} [platform='cli']  - 현재 플랫폼 ID (툴 필터링에 사용)
   * @param {Object} [channelRecord]   - 내부 Channel 레코드 (툴 실행 컨텍스트용)
   * @returns {Promise<{messages: string[], emotionDelta: Object, emotionReason: string}>}
   */
  async generate(
    context,
    systemInstruction,
    platform = "cli",
    channelRecord = null,
  ) {
    if (context.length === 0) {
      return { messages: ["..."], emotionDelta: {}, emotionReason: "" };
    }

    const stream = this.configManager.get("ai.chat.stream");

    // 활성화된 툴 목록 가져오기 (toolRegistry 없으면 빈 배열)
    const activeTools = this.toolRegistry
      ? this.toolRegistry.getActiveTools(platform)
      : [];
    const toolDeclarations = activeTools.map((t) => t.declaration);

    const maxSteps = this.configManager.get("tools.maxSteps") ?? 5;

    // DB 컨텍스트 + 이번 generation에서 발생한 tool 결과 (ephemeral, DB 저장 안 함)
    let ephemeralContext = [];
    const apiRequests = [];
    const apiResponses = [];

    for (let step = 0; step <= maxSteps; step++) {
      const fullContext = [...context, ...ephemeralContext];
      const toolCalls = [];
      let textBuffer = "";

      for await (const event of this.chatModel.generate(
        fullContext,
        systemInstruction,
        toolDeclarations,
        { stream },
      )) {
        if (event.type === "text") {
          textBuffer += event.content;
        } else if (event.type === "tool_call") {
          toolCalls.push({
            name: event.name,
            args: event.args,
            _rawPart: event._rawPart,
          });
        } else if (event.type === "api_request") {
          apiRequests.push(event.data);
        } else if (event.type === "api_response") {
          apiResponses.push(event.data);
        }
      }

      // tool_call이 없으면 최종 텍스트 응답 → JSON 파싱
      if (toolCalls.length === 0) {
        return {
          ...this._parseAIResponse(textBuffer),
          apiRequests,
          apiResponses,
        };
      }

      // maxSteps 초과 시 루프 탈출
      if (step === maxSteps) {
        console.warn(
          `[AIService] Tool call loop reached maxSteps (${maxSteps}), forcing stop`,
        );
        return {
          ...this._parseAIResponse(textBuffer),
          apiRequests,
          apiResponses,
        };
      }

      // 툴 실행
      const results = await this.toolExecutor.executeAll(
        toolCalls,
        platform,
        channelRecord,
      );

      // 툴 결과를 ephemeral context에 추가 (다음 AI 호출에 포함됨)
      ephemeralContext.push({
        role: "tool_result",
        calls: toolCalls.map((tc, i) => ({ ...tc, result: results[i] })),
      });

      console.log(
        `[AIService] Step ${step + 1}: executed ${toolCalls.length} tool(s), continuing loop`,
      );
    }

    return {
      messages: [],
      emotionDelta: {},
      emotionReason: "",
      apiRequests,
      apiResponses,
    };
  }

  /**
   * AI 텍스트 응답을 마크다운 포맷으로 파싱한다.
   * @param {string} text - AI 응답 텍스트
   * @returns {{messages: string[], emotionDelta: Object, emotionReason: string, relationshipDelta: Object}}
   */
  _parseAIResponse(text) {
    try {
      const parsed = {
        messages: [],
        emotionDelta: {},
        emotionReason: "",
        relationshipDelta: {},
      };

      const messagesMatch = text.match(/## messages\s*\n([\s\S]*?)(?=\n##|$)/i);
      const emotionDeltaMatch = text.match(
        /## emotion_delta\s*\n([\s\S]*?)(?=\n##|$)/i,
      );
      const emotionReasonMatch = text.match(
        /## emotion_reason\s*\n([\s\S]*?)(?=\n##|$)/i,
      );
      const relationshipDeltaMatch = text.match(
        /## relationship_delta\s*\n([\s\S]*?)(?=\n##|$)/i,
      );

      if (messagesMatch) {
        parsed.messages = messagesMatch[1]
          .split("[BREAK]")
          .map((m) => m.trim())
          .filter((m) => m.length > 0);
      } else {
        parsed.messages = [text.trim()];
      }

      const parseKeyValueLines = (matchResult, targetObj) => {
        if (!matchResult) return;
        const lines = matchResult[1].trim().split("\n");
        for (const line of lines) {
          const [key, value] = line.split(":");
          if (key && value) {
            targetObj[key.trim()] = parseInt(value.trim(), 10) || 0;
          }
        }
      };

      parseKeyValueLines(emotionDeltaMatch, parsed.emotionDelta);
      parseKeyValueLines(relationshipDeltaMatch, parsed.relationshipDelta);

      if (emotionReasonMatch) {
        parsed.emotionReason = emotionReasonMatch[1].trim();
      }

      return parsed;
    } catch (e) {
      console.warn(
        "[AIService] Failed to parse AI response as Markdown, using raw text:",
        e.message,
      );
      return {
        messages: [text.trim()],
        emotionDelta: {},
        emotionReason: "",
        relationshipDelta: {},
      };
    }
  }

  /**
   * Load system instruction from file (lazy loading).
   * @returns {Promise<string>}
   */
  async loadSystemInstruction() {
    if (!this.systemInstruction) {
      const systemInstructionPath = path.join(
        process.cwd(),
        "content/prompts/experiment/system.md",
      );
      this.systemInstruction = await fs.readFile(
        systemInstructionPath,
        "utf-8",
      );
    }
    return this.systemInstruction;
  }

  /**
   * 실험 프롬프트 part1, part2 템플릿을 로드한다.
   * @returns {Promise<{part1Template: string, part2Template: string}>}
   */
  async loadContextParts() {
    const base = path.join(process.cwd(), "content/prompts/experiment");
    const [part1Template, part2Template] = await Promise.all([
      fs.readFile(path.join(base, "part1.md"), "utf-8"),
      fs.readFile(path.join(base, "part2.md"), "utf-8"),
    ]);
    return { part1Template, part2Template };
  }

  /**
   * 시스템 프롬프트 템플릿의 변수를 실제 값으로 치환한다.
   *
   * 치환 대상:
   *   {character}         - 캐릭터 마크다운 파일 내용
   *   {emotionalState}    - 채널 스코프 감정 수치 (없으면 기본값)
   *   {relationshipState} - 유저별 관계 수치 (없으면 기본값)
   *   {currentTime}       - 현재 시각 (로컬)
   *
   * @param {string} template - 시스템 프롬프트 템플릿
   * @param {Object|null} channelRecord - 내부 Channel 레코드
   * @param {Object|null} userRecord - 현재 유저의 User 레코드
   * @returns {Promise<string>}
   */
  async _buildSystemInstruction(
    template,
    channelRecord = null,
    userRecord = null,
  ) {
    // {character} - CharacterLoader를 사용하여 동적 템플릿 렌더링
    const character = await this.characterLoader.load();

    // {emotionalState} — channelRecord.scope 기준으로 스코프 선택
    let emotionalState = EMOTION_KEYS.map((k) => `${k}: 50`).join("\n");
    if (this.emotionStateRepository && channelRecord?.id) {
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
        emotionalState = EMOTION_KEYS.map((k) => `${k}: ${state[k]}`).join(
          "\n",
        );
      } catch (e) {
        console.warn("[AIService] Failed to load emotion state:", e.message);
      }
    }

    // {currentTime}
    const currentTime = new Date().toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
    });

    // {relationshipState} — userRecord에서 관계 수치 로드
    const relationshipState = RELATIONSHIP_KEYS.map((k) => {
      const defaults = { affinity: 30, trust: 30, affection: 20 };
      const v = userRecord?.[k];
      return `${k}: ${typeof v === "number" ? v : defaults[k]}`;
    }).join("\n");

    return template
      .replace("{character}", character)
      .replace("{emotionalState}", emotionalState)
      .replace("{relationshipState}", relationshipState)
      .replace("{currentTime}", currentTime);
  }

  createModel(purpose) {
    const config = this.configManager.get(`ai.${purpose}`);

    switch (config.provider) {
      case "gemini":
        return new GeminiProvider(this.configManager, purpose);
      case "vertex":
        return new VertexProvider(this.configManager, purpose);
      //case "openai":
      //return new OpenAIProvider(this.configManager, purpose);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }
}
