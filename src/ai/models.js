import { createGateway } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { getAiSettings } from "./config.js";
import { loadAiCredentials } from "./credentials.js";

export function createLanguageModel(
  configManager,
  purpose = "chat",
  credentials = loadAiCredentials(),
) {
  const settings = getAiSettings(configManager, purpose);
  return createProvider(configManager, settings, credentials).language(
    settings.model,
  );
}

export function createImageModel(
  configManager,
  purpose = "image",
  credentials = loadAiCredentials(),
) {
  const settings = getAiSettings(configManager, purpose);
  return createProvider(configManager, settings, credentials).image(
    settings.model,
  );
}

function createProvider(configManager, settings, credentials) {
  const provider = settings.provider ?? "gateway";

  if (provider === "gateway") {
    const gateway = createGateway({
      apiKey: credentials.aiGatewayApiKey,
      baseURL: settings.baseURL,
    });

    return {
      language: (model) => gateway(model),
      image: (model) => gateway.image(model),
    };
  }

  if (provider === "openai") {
    const openai = createOpenAI({
      apiKey: credentials.openaiApiKey,
      baseURL: settings.baseURL,
    });

    return {
      language: (model) => openai(model),
      image: (model) => openai.image(model),
    };
  }

  if (provider === "google") {
    const google = createGoogleGenerativeAI({
      apiKey: credentials.googleApiKey,
      baseURL: settings.baseURL,
    });

    return {
      language: (model) => google(model),
      image: (model) => google.image(model),
    };
  }

  if (provider === "vertex") {
    const vertex = createVertex(
      buildVertexOptions(configManager, settings, credentials),
    );

    return {
      language: (model) => vertex(model),
      image: (model) => vertex.image(model),
    };
  }

  if (provider === "openaiCompatible") {
    const compatible = createOpenAICompatible({
      name: settings.name ?? "openai-compatible",
      baseURL: settings.baseURL,
      apiKey: credentials.openaiCompatibleApiKey,
    });

    return {
      language: (model) => compatible(model),
      image: (model) => compatible.imageModel(model),
    };
  }

  if (provider === "xai") {
    const xai = createXai({
      apiKey: credentials.xaiApiKey,
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

function buildVertexOptions(configManager, settings, credentials) {
  const clientEmail = credentials.vertexClientEmail;
  const privateKey = credentials.vertexPrivateKey;
  const options = {
    project: configManager.get("ai.vertex.projectId"),
    location: configManager.get("ai.vertex.location") || "global",
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
