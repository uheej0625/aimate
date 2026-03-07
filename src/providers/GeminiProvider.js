import { GoogleGenAI } from "@google/genai";

export class GeminiProvider {
  constructor(configManager, purpose) {
    this.purpose = purpose;
    this.settings = configManager.get(`ai.${purpose}`);
    this.configManager = configManager;
    this.ai = new GoogleGenAI({
      apiKey: configManager.get("secrets.geminiApiKey"),
    });
  }

  /**
   * Build the Gemini API request object.
   *
   * context 항목은 두 가지 형태를 지원한다:
   *   - 일반 메시지:  { role: 'user'|'assistant', content: string }
   *   - 툴 결과:      { role: 'tool_result', calls: [{ name, args, result }] }
   *     → model 턴(functionCall) + user 턴(functionResponse) 쌍으로 변환
   *
   * @param {Array}    context          - 대화 컨텍스트
   * @param {string}   systemPrompt     - 시스템 프롬프트
   * @param {Object[]} [toolDeclarations] - Gemini 함수 선언 배열
   * @returns {Object} Gemini API 요청 객체
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
            functionResponse: { name: c.name, response: c.result ?? {} },
          })),
        });
      } else {
        contents.push({
          role: message.role === "user" ? "user" : "model",
          parts: [{ text: message.content }],
        });
      }
    }

    const request = {
      model: this.settings.model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: this.settings.temperature,
        maxOutputTokens: this.settings.maxTokens,
        topP: this.settings.topP,
        topK: this.settings.topK,
      },
    };

    if (toolDeclarations.length > 0) {
      request.config.tools = [{ functionDeclarations: toolDeclarations }];
    }

    return request;
  }

  /**
   * 응답을 정규화된 이벤트 스트림으로 yield하는 async generator.
   *
   * yield 형태:
   *   { type: 'text',      content: string }
   *   { type: 'tool_call', name: string, args: Object }
   *
   * - toolDeclarations가 있으면 function calling을 활성화하고 non-streaming으로 전환
   *   (Gemini의 streaming + function call은 완전한 지원이 불안정)
   * - toolDeclarations가 없으면 stream 옵션을 그대로 사용
   *
   * @param {Array}    context
   * @param {string}   systemPrompt
   * @param {Object[]} [toolDeclarations]
   * @param {Object}   [options]
   * @param {boolean}  [options.stream=false]
   * @yields {{ type: string, content?: string, name?: string, args?: Object }}
   */
  async *generate(
    context,
    systemPrompt,
    toolDeclarations = [],
    { stream = false } = {},
  ) {
    const request = this._buildRequest(context, systemPrompt, toolDeclarations);
    const maxRetries = this.settings.retryAttempts || 3;
    const retryDelay = this.settings.retryDelay || 2000;

    // function calling 활성화 시 streaming은 사용하지 않음
    const useStream = stream && toolDeclarations.length === 0;

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (useStream) {
          const response = await this.ai.models.generateContentStream(request);
          for await (const chunk of response) {
            const text = chunk.text ?? "";
            if (text) yield { type: "text", content: text };
          }
        } else {
          const response = await this.ai.models.generateContent(request);
          const parts = response.candidates?.[0]?.content?.parts ?? [];

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

          // @google/genai 단축 접근자 fallback (parts가 비어있는 경우)
          if (parts.length === 0 && response.text) {
            yield { type: "text", content: response.text };
          }
        }
        return;
      } catch (error) {
        lastError = error;

        const is503 =
          error.status === 503 ||
          (error.message && error.message.includes('"code": 503'));

        if (is503 && attempt < maxRetries) {
          console.log(
            `[Retry ${attempt + 1}/${maxRetries}] 503 error, retrying in ${retryDelay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }
}
