import fs from "fs/promises";
import {
  createGateway,
  generateImage,
  generateText,
  jsonSchema,
  streamText,
} from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createLogger } from "../core/logger.js";

const logger = createLogger("AISDKProvider");

const SUPPORTED_AI_SDK_PROVIDERS = [
  "gateway",
  "openai",
  "google",
  "vertex",
  "openaiCompatible",
];

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return "[unserializable]";
  }
}

export class AISDKProvider {
  static validateConfig(configManager, purpose) {
    const missing = [];
    const settings = configManager.get(`ai.${purpose}`);
    const provider = settings?.aiSdk?.provider ?? "gateway";

    if (!settings?.model) {
      missing.push(`ai.${purpose}.model`);
    }

    if (!SUPPORTED_AI_SDK_PROVIDERS.includes(provider)) {
      missing.push(
        `ai.${purpose}.aiSdk.provider (${SUPPORTED_AI_SDK_PROVIDERS.join(", ")})`,
      );
      return missing;
    }

    if (provider === "gateway") {
      const hasGatewayAuth =
        configManager.get("secrets.aiGatewayApiKey") ||
        process.env.AI_GATEWAY_API_KEY ||
        process.env.VERCEL_OIDC_TOKEN;
      if (!hasGatewayAuth) {
        missing.push("AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN");
      }
    } else if (provider === "openai") {
      if (!configManager.get("secrets.openaiApiKey")) {
        missing.push("OPENAI_API_KEY");
      }
    } else if (provider === "google") {
      if (!configManager.get("secrets.googleCloudApiKey")) {
        missing.push("GOOGLE_CLOUD_API_KEY");
      }
    } else if (provider === "vertex") {
      if (!configManager.get("secrets.vertexProjectId")) {
        missing.push("VERTEX_PROJECT_ID");
      }
      if (!configManager.get("secrets.vertexLocation")) {
        missing.push("VERTEX_LOCATION");
      }
      if (!configManager.get("secrets.vertexClientEmail")) {
        missing.push("VERTEX_CLIENT_EMAIL");
      }
      if (!configManager.get("secrets.vertexPrivateKey")) {
        missing.push("VERTEX_PRIVATE_KEY");
      }
    } else if (provider === "openaiCompatible") {
      if (!settings.aiSdk?.baseURL) {
        missing.push(`ai.${purpose}.aiSdk.baseURL`);
      }
      if (
        !settings.aiSdk?.apiKey &&
        !configManager.get("secrets.aiSdkOpenAICompatibleApiKey")
      ) {
        missing.push("AI_SDK_OPENAI_COMPATIBLE_API_KEY");
      }
    }

    return missing;
  }

  constructor(configManager, purpose) {
    this.purpose = purpose;
    this.settings = configManager.get(`ai.${purpose}`);
    this.configManager = configManager;

    if (!this.settings) {
      throw new Error(`AISDKProvider requires ai.${purpose} settings`);
    }

    this.aiSdkSettings = {
      provider: "gateway",
      ...this.settings.aiSdk,
    };
  }

  _getProviderName() {
    return this.aiSdkSettings.provider ?? "gateway";
  }

  _getProviderOptions() {
    return this.settings.providerOptions ?? this.aiSdkSettings.providerOptions;
  }

  _getLanguageModel() {
    const model = this.settings.model;
    const provider = this._getProviderName();

    switch (provider) {
      case "gateway":
        return this._createGatewayProvider()(model);
      case "openai":
        return createOpenAI({
          apiKey: this.configManager.get("secrets.openaiApiKey"),
          baseURL: this.aiSdkSettings.baseURL,
        })(model);
      case "google":
        return createGoogleGenerativeAI({
          apiKey: this.configManager.get("secrets.googleCloudApiKey"),
          baseURL: this.aiSdkSettings.baseURL,
        })(model);
      case "vertex":
        return this._createVertexProvider()(model);
      case "openaiCompatible":
        return this._createOpenAICompatibleProvider()(model);
      default:
        throw new Error(`Unsupported AI SDK provider: ${provider}`);
    }
  }

  _getImageModel() {
    const model = this.settings.model;
    const provider = this._getProviderName();

    switch (provider) {
      case "gateway":
        return this._createGatewayProvider().image(model);
      case "openai":
        return createOpenAI({
          apiKey: this.configManager.get("secrets.openaiApiKey"),
          baseURL: this.aiSdkSettings.baseURL,
        }).image(model);
      case "google":
        return createGoogleGenerativeAI({
          apiKey: this.configManager.get("secrets.googleCloudApiKey"),
          baseURL: this.aiSdkSettings.baseURL,
        }).image(model);
      case "vertex":
        return this._createVertexProvider().image(model);
      case "openaiCompatible":
        return this._createOpenAICompatibleProvider().imageModel(model);
      default:
        throw new Error(`Unsupported AI SDK image provider: ${provider}`);
    }
  }

  _createVertexProvider() {
    const location =
      this.configManager.get("secrets.vertexLocation") || "us-central1";
    const clientEmail = this.configManager.get("secrets.vertexClientEmail");
    const privateKey = this.configManager.get("secrets.vertexPrivateKey");

    const options = {
      project: this.configManager.get("secrets.vertexProjectId"),
      location,
      baseURL: this.aiSdkSettings.baseURL,
    };

    if (clientEmail && privateKey) {
      options.googleAuthOptions = {
        credentials: {
          client_email: clientEmail,
          private_key: privateKey,
        },
      };
    }

    return createVertex(options);
  }

  _createGatewayProvider() {
    return createGateway({
      apiKey:
        this.configManager.get("secrets.aiGatewayApiKey") ||
        process.env.AI_GATEWAY_API_KEY ||
        process.env.VERCEL_OIDC_TOKEN,
      baseURL: this.aiSdkSettings.baseURL,
    });
  }

  _createOpenAICompatibleProvider() {
    return createOpenAICompatible({
      name: this.aiSdkSettings.name ?? "openaiCompatible",
      baseURL: this.aiSdkSettings.baseURL,
      apiKey:
        this.aiSdkSettings.apiKey ??
        this.configManager.get("secrets.aiSdkOpenAICompatibleApiKey"),
    });
  }

  _buildMessages(context) {
    const messages = [];

    for (const message of context) {
      if (message.role === "tool_result") {
        const calls = message.calls ?? [];
        messages.push({
          role: "assistant",
          content: calls.map((call, index) => ({
            type: "tool-call",
            toolCallId: call.id ?? `tool-${index}`,
            toolName: call.name,
            input: call.args ?? {},
          })),
        });
        messages.push({
          role: "tool",
          content: calls.map((call, index) => ({
            type: "tool-result",
            toolCallId: call.id ?? `tool-${index}`,
            toolName: call.name,
            output: call.result ?? {},
          })),
        });
      } else {
        messages.push({
          role: message.role === "user" ? "user" : "assistant",
          content: message.content ?? "",
        });
      }
    }

    return messages;
  }

  _buildTools(toolDeclarations = []) {
    if (toolDeclarations.length === 0) return undefined;

    return Object.fromEntries(
      toolDeclarations.map((declaration) => [
        declaration.name,
        {
          description: declaration.description,
          inputSchema: jsonSchema(declaration.parameters ?? {}),
        },
      ]),
    );
  }

  _buildCallOptions(context, systemPrompt, toolDeclarations = []) {
    const options = {
      model: this._getLanguageModel(),
      system: systemPrompt || undefined,
      messages: this._buildMessages(context),
      tools: this._buildTools(toolDeclarations),
      temperature: this.settings.temperature ?? undefined,
      maxOutputTokens: this.settings.maxTokens ?? undefined,
      topP: this.settings.topP ?? undefined,
      topK: this.settings.topK ?? undefined,
      maxRetries: this.settings.retryAttempts ?? undefined,
      providerOptions: this._getProviderOptions(),
    };

    for (const key of Object.keys(options)) {
      if (!hasValue(options[key])) delete options[key];
    }

    return options;
  }

  _summarizeCallOptions(options, toolDeclarations = []) {
    return {
      provider: this._getProviderName(),
      model: this.settings.model,
      system: options.system,
      messages: options.messages,
      tools: toolDeclarations.map((tool) => tool.name),
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      topP: options.topP,
      topK: options.topK,
      maxRetries: options.maxRetries,
      providerOptions: options.providerOptions,
    };
  }

  /**
   * Yield the same normalized events as the existing providers.
   */
  async *generateChat(
    context,
    systemPrompt,
    toolDeclarations = [],
    { stream = false } = {},
  ) {
    const options = this._buildCallOptions(
      context,
      systemPrompt,
      toolDeclarations,
    );
    yield {
      type: "api_request",
      data: this._summarizeCallOptions(options, toolDeclarations),
    };

    const useStream = stream && toolDeclarations.length === 0;

    if (useStream) {
      const result = streamText(options);
      for await (const part of result.fullStream) {
        if (part.type === "text-delta" && part.text) {
          yield { type: "text", content: part.text };
        } else if (part.type === "tool-call") {
          yield {
            type: "tool_call",
            id: part.toolCallId,
            name: part.toolName,
            args: part.input ?? {},
            _rawPart: part,
          };
        }
      }
      yield {
        type: "api_response",
        data: safeJson(await result.response),
      };
      return;
    }

    const result = await generateText(options);
    yield {
      type: "api_response",
      data: safeJson({
        response: result.response,
        finishReason: result.finishReason,
        usage: result.usage,
        totalUsage: result.totalUsage,
        warnings: result.warnings,
      }),
    };

    if (result.text) {
      yield { type: "text", content: result.text };
    }

    for (const call of result.toolCalls ?? []) {
      yield {
        type: "tool_call",
        id: call.toolCallId,
        name: call.toolName,
        args: call.input ?? {},
        _rawPart: call,
      };
    }
  }

  async generateImage(prompt, options = {}) {
    const imageModel = this._getImageModel();
    const imagePaths = options.image
      ? Array.isArray(options.image)
        ? options.image
        : [options.image]
      : [];
    const imageBuffers = await Promise.all(
      imagePaths.map((imagePath) =>
        typeof imagePath === "string" ? fs.readFile(imagePath) : imagePath,
      ),
    );

    const request = {
      model: imageModel,
      prompt:
        imageBuffers.length > 0
          ? { text: prompt, images: imageBuffers }
          : prompt,
      size: options.size,
      providerOptions: this._getProviderOptions(),
      maxRetries: this.settings.retryAttempts ?? undefined,
    };

    for (const key of Object.keys(request)) {
      if (!hasValue(request[key])) delete request[key];
    }

    logger.info(
      {
        provider: this._getProviderName(),
        model: this.settings.model,
        hasReferenceImages: imageBuffers.length > 0,
      },
      "Generating image via AI SDK",
    );

    const response = await generateImage(request);
    const image = response.image;

    if (!image?.uint8Array) {
      throw new Error("AI SDK image response did not include image data");
    }

    return {
      buffer: Buffer.from(image.uint8Array),
      request: {
        provider: this._getProviderName(),
        model: this.settings.model,
        prompt,
        size: options.size,
        providerOptions: request.providerOptions,
        image: imagePaths.map((imagePath) =>
          typeof imagePath === "string" ? imagePath : "[uploadable]",
        ),
      },
      response: safeJson({
        mediaType: image.mediaType,
        warnings: response.warnings,
        responses: response.responses,
        providerMetadata: response.providerMetadata,
        usage: response.usage,
      }),
    };
  }
}
