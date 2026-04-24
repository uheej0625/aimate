import OpenAI from "openai";
import { createLogger } from "../core/logger.js";

const logger = createLogger("OpenAIProvider");

export class OpenAIProvider {
  constructor(configManager, purpose) {
    this.purpose = purpose;
    this.settings = configManager.get(`ai.${purpose}`);
    this.configManager = configManager;
    this.ai = new OpenAI({
      apiKey: configManager.get("secrets.openaiApiKey"),
    });
  }

  // /**
  //  * Build the Google Cloud API request object.
  //  *
  //  * context 항목은 두 가지 형태를 지원한다:
  //  *   - 일반 메시지:  { role: 'user'|'assistant', content: string }
  //  *   - 툴 결과:      { role: 'tool_result', calls: [{ name, args, result }] }
  //  *     → model 턴(functionCall) + user 턴(functionResponse) 쌍으로 변환
  //  *
  //  * @param {Array}    context          - 대화 컨텍스트
  //  * @param {string}   systemPrompt     - 시스템 프롬프트
  //  * @param {Object[]} [toolDeclarations] - Google Cloud 함수 선언 배열
  //  * @returns {Object} Google Cloud API 요청 객체
  //  */
  // _buildChatRequest(context, systemPrompt, toolDeclarations = []) {
  //   const messages = [];

  //   if (systemPrompt) {
  //     messages.push({ role: "system", content: systemPrompt });
  //   }

  //   for (const message of context) {
  //     if (message.role === "tool_result") {
  //       for (const call of message.calls) {
  //         messages.push({
  //           role: "tool",
  //           tool_call_id: call.id,
  //           content: JSON.stringify(call.result ?? {}),
  //         });
  //       }
  //     } else {
  //       messages.push({
  //         role: message.role === "user" ? "user" : "assistant",
  //         content: message.content,
  //       });
  //     }
  //   }

  //   const request = {
  //     model: this.settings.model,
  //     messages,
  //     temperature: this.settings.temperature ?? 1.0,
  //     max_tokens: this.settings.maxTokens,
  //     top_p: this.settings.topP ?? 1.0,
  //   };

  //   if (toolDeclarations.length > 0) {
  //     request.tools = toolDeclarations.map((decl) => ({
  //       type: "function",
  //       function: {
  //         name: decl.name,
  //         description: decl.description,
  //         parameters: decl.parameters,
  //       },
  //     }));
  //   }

  //   return request;
  // }

  // async *generateChat(
  //   context,
  //   systemPrompt,
  //   toolDeclarations = [],
  //   { stream = false } = {},
  // ) {
  //   const request = this._buildChatRequest(
  //     context,
  //     systemPrompt,
  //     toolDeclarations,
  //   );
  //   yield { type: "api_request", data: request };

  //   const maxRetries = this.settings.retryAttempts || 3;
  //   const retryDelay = this.settings.retryDelay || 2000;

  //   const useStream = stream && toolDeclarations.length === 0;
  //   if (useStream) {
  //     request.stream = true;
  //   }

  //   let lastError = null;
  //   for (let attempt = 0; attempt <= maxRetries; attempt++) {
  //     try {
  //       if (useStream) {
  //         const response = await this.ai.chat.completions.create(request);
  //         for await (const chunk of response) {
  //           const text = chunk.choices[0]?.delta?.content ?? "";
  //           if (text) yield { type: "text", content: text };
  //         }
  //       } else {
  //         const response = await this.ai.chat.completions.create(request);
  //         yield { type: "api_response", data: response };

  //         const message = response.choices[0]?.message;
  //         if (!message) return;

  //         if (message.content) {
  //           yield { type: "text", content: message.content };
  //         }

  //         if (message.tool_calls) {
  //           for (const toolCall of message.tool_calls) {
  //             yield {
  //               type: "tool_call",
  //               name: toolCall.function.name,
  //               args: JSON.parse(toolCall.function.arguments),
  //               _rawPart: null,
  //               id: toolCall.id,
  //             };
  //           }
  //         }
  //       }
  //       return;
  //     } catch (error) {
  //       lastError = error;
  //       if (error.status === 429 || error.status >= 500) {
  //         logger.warn(
  //           { attempt: attempt + 1, maxRetries, retryDelay },
  //           `API error, retrying...`,
  //         );
  //         await new Promise((resume) => setTimeout(resume, retryDelay));
  //         continue;
  //       }
  //       throw error;
  //     }
  //   }
  //   throw lastError;
  // }

  async generateImage(prompt, options = {}) {
    const request = {
      model: this.settings.model,
      prompt,
    };

    if (options.size) {
      request.size = options.size;
    }

    logger.info({ prompt }, "Generating image via OpenAI");
    const response = await this.ai.images.generate(request);

    const imageBase64 = response.data[0].b64_json;
    return Buffer.from(imageBase64, "base64"); // Buffer 반환
  }
}
