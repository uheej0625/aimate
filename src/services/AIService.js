import { GoogleCloudProvider } from "../providers/GoogleCloudProvider.js";
import { VertexProvider } from "../providers/VertexProvider.js";
import { OpenAIProvider } from "../providers/OpenAIProvider.js";
import { CharacterLoader } from "../loaders/CharacterLoader.js";
import { PromptComposer } from "./PromptComposer.js";
import { SequenceBuilder } from "./SequenceBuilder.js";
import { createLogger } from "../core/logger.js";
import {
  GENERATED_IMAGE_TAG_REGEX,
  normalizeImageId,
} from "../tools/imageReferenceUtils.js";

const logger = createLogger("AIService");

export class AIService {
  /**
   * @param {import('../services/HistoryService.js').HistoryService} historyService
   * @param {import('../config/ConfigManager.js').default} configManager
   * @param {import('../tools/ToolRegistry.js').ToolRegistry} [toolRegistry]
   * @param {import('../tools/ToolExecutor.js').ToolExecutor} [toolExecutor]
   * @param {import('./PromptComposer.js').PromptComposer} [promptComposer]
   * @param {import('../repositories/UserRepository.js').UserRepository} [userRepository]
   * @param {import('./SequenceBuilder.js').SequenceBuilder} [sequenceBuilder]
   */
  constructor(
    historyService,
    configManager,
    toolRegistry = null,
    toolExecutor = null,
    promptComposer = null,
    userRepository = null,
    sequenceBuilder = null,
  ) {
    this.configManager = configManager;
    this.historyService = historyService;
    this.toolRegistry = toolRegistry;
    this.toolExecutor = toolExecutor;
    this.promptComposer =
      promptComposer ??
      new PromptComposer(new CharacterLoader(), null, configManager);
    this.sequenceBuilder =
      sequenceBuilder ?? new SequenceBuilder(this.promptComposer);
    this.userRepository = userRepository;

    this.chatModel = this.createModel("chat");
    this.imageModel = this.createModel("image");
    //this.summaryModel = this.createModel("summary");
    //this.embeddingModel = this.createModel("embedding");
  }

  /**
   * Prepare the context and system instruction for a reply.
   * @param {string} channelId - Internal channel ID
   * @param {string} botId
   * @param {Object} [channelRecord] - 내부 Channel 레코드 (emotion state 조회용)
   * @param {string} [cronMessage] - Cron job에서 전달되는 시스템 메시지 (선택)
   * @returns {Promise<{context: Array, systemInstruction: string, messageIds: Array, inputMessages: Array<string>, currentUserId: string|null}>}
   */
  async prepareContext(
    channelId,
    botId,
    channelRecord = null,
    cronMessage = null,
  ) {
    // 1. DB에서 히스토리 모두 로드 (단일 쿼리)
    const {
      historyMessages,
      pendingMessages,
      messageIds,
      inputMessages,
      lastUserPlatformAccountId,
    } = await this.historyService.fetchHistoryData(channelId, botId);

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
        logger.warn({ err: e }, "Failed to load relationship state");
      }
    }

    // 3. sequence.js 및 컨텍스트 빌드
    const promptName = this.configManager.get("ai.chat.prompt") || "default";
    const sequenceDef = await this.sequenceBuilder.loadSequence(promptName);
    const { systemInstruction, context } = await this.sequenceBuilder.build(
      sequenceDef,
      {
        historyMessages,
        pendingMessages,
        botId,
        cronMessage,
        channelRecord,
        userRecord,
        promptName,
      },
    );

    return {
      context,
      systemInstruction,
      messageIds,
      inputMessages,
      currentUserId,
    };
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
  async generateChat(
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
    const generatedImageTags = [];
    const apiRequests = [];
    const apiResponses = [];

    for (let step = 0; step <= maxSteps; step++) {
      const fullContext = [...context, ...ephemeralContext];
      const toolCalls = [];
      let textBuffer = "";

      for await (const event of this.chatModel.generateChat(
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
          ...this._withGeneratedImageTags(
            this._parseAIResponse(textBuffer),
            generatedImageTags,
          ),
          apiRequests,
          apiResponses,
        };
      }

      // maxSteps 초과 시 루프 탈출
      if (step === maxSteps) {
        logger.warn(
          { maxSteps },
          "Tool call loop reached maxSteps, forcing stop",
        );
        return {
          ...this._withGeneratedImageTags(
            this._parseAIResponse(textBuffer),
            generatedImageTags,
          ),
          apiRequests,
          apiResponses,
        };
      }

      // 툴 실행
      const results = await this.toolExecutor.executeAll(
        toolCalls,
        platform,
        channelRecord,
        this, // aiService 주입
      );

      for (const tag of this._extractGeneratedImageTags(results)) {
        if (!generatedImageTags.includes(tag)) {
          generatedImageTags.push(tag);
        }
      }

      // 툴 결과를 ephemeral context에 추가 (다음 AI 호출에 포함됨)
      ephemeralContext.push({
        role: "tool_result",
        calls: toolCalls.map((tc, i) => ({ ...tc, result: results[i] })),
      });

      logger.info(
        { step: step + 1, toolCount: toolCalls.length },
        "Executed tools, continuing loop",
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
      logger.warn(
        { err: e },
        "Failed to parse AI response as Markdown, using raw text",
      );
      return {
        messages: [text.trim()],
        emotionDelta: {},
        emotionReason: "",
        relationshipDelta: {},
      };
    }
  }

  _extractGeneratedImageTags(toolResults = []) {
    const tags = [];
    const addImageId = (imageId) => {
      const normalized = normalizeImageId(imageId);
      if (normalized) tags.push(`[IMAGE:${normalized}]`);
    };

    for (const result of toolResults) {
      if (!result || result.error) continue;

      if (result.imageId) {
        addImageId(result.imageId);
      }

      if (result.instruction) {
        GENERATED_IMAGE_TAG_REGEX.lastIndex = 0;
        let match;
        while (
          (match = GENERATED_IMAGE_TAG_REGEX.exec(result.instruction)) !== null
        ) {
          addImageId(match[1]);
        }
      }
    }

    return [...new Set(tags)];
  }

  _withGeneratedImageTags(parsed, generatedImageTags = []) {
    if (!generatedImageTags.length) return parsed;

    const existingText = parsed.messages.join("\n");
    const missingTags = generatedImageTags.filter(
      (tag) => !existingText.includes(tag),
    );
    if (!missingTags.length) return parsed;

    if (parsed.messages.length === 0) {
      parsed.messages = missingTags;
      return parsed;
    }

    const lastIndex = parsed.messages.length - 1;
    parsed.messages[lastIndex] =
      `${parsed.messages[lastIndex]}\n${missingTags.join("\n")}`.trim();
    return parsed;
  }

  createModel(purpose) {
    const config = this.configManager.get(`ai.${purpose}`);

    switch (config.provider) {
      case "googleCloud":
        return new GoogleCloudProvider(this.configManager, purpose);
      case "vertex":
        return new VertexProvider(this.configManager, purpose);
      case "openai":
        return new OpenAIProvider(this.configManager, purpose);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  async generateImage(prompt, options = {}) {
    return this.imageModel.generateImage(prompt, options);
  }
}
