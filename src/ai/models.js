import { createGateway } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { getAiSettings } from "./config.js";

export function createLanguageModel(configManager, purpose = "chat") {
  const settings = getAiSettings(configManager, purpose);
  return createProvider(configManager, settings).language(settings.model);
}

export function createImageModel(configManager, purpose = "image") {
  const settings = getAiSettings(configManager, purpose);
  return createProvider(configManager, settings).image(settings.model);
}

function createProvider(configManager, settings) {
  const provider = settings.provider ?? "gateway";

  if (provider === "gateway") {
    const gateway = createGateway({
      apiKey:
        configManager.get("secrets.aiGatewayApiKey") ||
        process.env.AI_GATEWAY_API_KEY ||
        process.env.VERCEL_OIDC_TOKEN,
      baseURL: settings.baseURL,
    });

    return {
      language: (model) => gateway(model),
      image: (model) => gateway.image(model),
    };
  }

  if (provider === "openai") {
    const openai = createOpenAI({
      apiKey: configManager.get("secrets.openaiApiKey"),
      baseURL: settings.baseURL,
    });

    return {
      language: (model) => openai(model),
      image: (model) => openai.image(model),
    };
  }

  if (provider === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: configManager.get("secrets.googleApiKey"),
      baseURL: settings.baseURL,
    });

    return {
      language: (model) => google(model),
      image: (model) => google.image(model),
    };
  }

  if (provider === "vertex") {
    const vertex = createVertex(buildVertexOptions(configManager, settings));

    return {
      language: (model) => vertex(model),
      image: (model) => vertex.image(model),
    };
  }

  if (provider === "openaiCompatible") {
    const compatible = createOpenAICompatible({
      name: settings.name ?? "openai-compatible",
      baseURL: settings.baseURL,
      apiKey:
        settings.apiKey ?? configManager.get("secrets.openaiCompatibleApiKey"),
    });

    return {
      language: (model) => compatible(model),
      image: (model) => compatible.imageModel(model),
    };
  }

  if (provider === "xai") {
    const xai = createXai({
      apiKey: configManager.get("secrets.xaiApiKey"),
      baseURL: settings.baseURL,
    });

    return {
      language: (model) =>
        settings.api === "responses" ? xai.responses(model) : xai(model),
      image: (model) => xai.image(model),
    };
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}

function buildVertexOptions(configManager, settings) {
  const clientEmail = configManager.get("secrets.vertexClientEmail");
  const privateKey = configManager.get("secrets.vertexPrivateKey");
  const options = {
    project: configManager.get("secrets.vertexProjectId"),
    location: configManager.get("secrets.vertexLocation") || "global",
    baseURL: settings.baseURL,
  };

  if (clientEmail && privateKey) {
    options.googleAuthOptions = {
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
    };
  }

  return options;
}
