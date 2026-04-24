import { VertexAI } from "@google-cloud/vertexai";
import { createLogger } from "../core/logger.js";

const logger = createLogger("VertexProvider");

export class VertexProvider {
  constructor(configManager, purpose) {
    this.purpose = purpose;
    this.settings = configManager.get(`ai.${purpose}`);
    this.configManager = configManager;

    const project = configManager.get("secrets.vertexProjectId");
    const location =
      configManager.get("secrets.vertexLocation") || "us-central1";
    const clientEmail = configManager.get("secrets.vertexClientEmail");
    const privateKey = configManager.get("secrets.vertexPrivateKey");

    const options = { project, location };

    // 서비스 계정 키가 있으면 googleAuthOptions로 인증
    if (clientEmail && privateKey) {
      options.googleAuthOptions = {
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
      };
    }

    this.vertexAI = new VertexAI(options);
  }

  /**
   * Build the Vertex AI API request object.
   *
   * context 항목은 두 가지 형태를 지원한다:
   *   - 일반 메시지:  { role: 'user'|'assistant', content: string }
   *   - 툴 결과:      { role: 'tool_result', calls: [{ name, args, result }] }
   *     → model 턴(functionCall) + user 턴(functionResponse) 쌍으로 변환
   *
   * @param {Array}    context          - 대화 컨텍스트
   * @param {string}   systemPrompt     - 시스템 프롬프트
   * @param {Object[]} [toolDeclarations] - 함수 선언 배열
   * @returns {Object} Vertex AI API 요청 객체
   */
  _buildRequest(context, systemPrompt, toolDeclarations = []) {
    const contents = [];

    for (const message of context) {
      if (message.role === "tool_result") {
        // tool_result → model(functionCall) + user(functionResponse) 쌍
        // _rawPart를 그대로 사용해야 thought_signature가 보존됨
        contents.push({
          role: "model",
          parts: message.calls.map(
            (c) =>
              c._rawPart ?? {
                functionCall: { name: c.name, args: c.args ?? {} },
              },
          ),
        });
        contents.push({
          role: "user",
          parts: message.calls.map((c) => ({
            functionResponse: {
              name: c.name,
              response: c.result ?? {},
            },
          })),
        });
      } else {
        contents.push({
          role: message.role === "user" ? "user" : "model",
          parts: [{ text: message.content }],
        });
      }
    }

    const request = { contents };

    // systemInstruction은 요청 레벨에서 전달
    if (systemPrompt) {
      request.systemInstruction = {
        role: "system",
        parts: [{ text: systemPrompt }],
      };
    }

    if (toolDeclarations.length > 0) {
      request.tools = [{ functionDeclarations: toolDeclarations }];
    }

    return request;
  }

  /**
   * GenerativeModel 인스턴스를 생성한다.
   * generationConfig는 모델 생성 시 전달한다.
   */
  _getModel() {
    const generationConfig = {};
    if (this.settings.temperature != null)
      generationConfig.temperature = this.settings.temperature;
    if (this.settings.maxTokens != null)
      generationConfig.maxOutputTokens = this.settings.maxTokens;
    if (this.settings.topP != null) generationConfig.topP = this.settings.topP;
    if (this.settings.topK != null) generationConfig.topK = this.settings.topK;

    return this.vertexAI.getGenerativeModel({
      model: this.settings.model,
      generationConfig,
    });
  }

  /**
   * 응답을 정규화된 이벤트 스트림으로 yield하는 async generator.
   *
   * yield 형태:
   *   { type: 'text',      content: string }
   *   { type: 'tool_call', name: string, args: Object }
   *
   * - toolDeclarations가 있으면 function calling을 활성화하고 non-streaming으로 전환
   * - toolDeclarations가 없으면 stream 옵션을 그대로 사용
   *
   * @param {Array}    context
   * @param {string}   systemPrompt
   * @param {Object[]} [toolDeclarations]
   * @param {Object}   [options]
   * @param {boolean}  [options.stream=false]
   * @yields {{ type: string, content?: string, name?: string, args?: Object }}
   */
  async *generateChat(
    context,
    systemPrompt,
    toolDeclarations = [],
    { stream = false } = {},
  ) {
    const request = this._buildRequest(context, systemPrompt, toolDeclarations);
    yield { type: "api_request", data: request };

    const model = this._getModel();
    const maxRetries = this.settings.retryAttempts || 3;
    const retryDelay = this.settings.retryDelay || 2000;

    // function calling 활성화 시 streaming은 사용하지 않음
    const useStream = stream && toolDeclarations.length === 0;

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (useStream) {
          const streamingResult = await model.generateContentStream(request);
          for await (const item of streamingResult.stream) {
            const text = item.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (text) yield { type: "text", content: text };
          }
        } else {
          const result = await model.generateContent(request);
          yield { type: "api_response", data: result.response };

          const parts = result.response?.candidates?.[0]?.content?.parts ?? [];

          for (const part of parts) {
            if (part.text) {
              yield { type: "text", content: part.text };
            } else if (part.functionCall) {
              yield {
                type: "tool_call",
                name: part.functionCall.name,
                args: part.functionCall.args ?? {},
                _rawPart: part, // thought_signature 등 원본 필드 보존
              };
            }
          }

          // fallback: parts가 비어있는 경우
          if (parts.length === 0) {
            const text =
              result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) yield { type: "text", content: text };
          }
        }
        return;
      } catch (error) {
        lastError = error;

        const is503 =
          error.status === 503 ||
          (error.message && error.message.includes("503"));

        if (is503 && attempt < maxRetries) {
          logger.warn(
            { attempt: attempt + 1, maxRetries, retryDelay },
            "503 error, retrying...",
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  async generateImage(prompt, options = {}) {
    throw new Error("generateImage is not implemented yet for VertexProvider");
  }
}
