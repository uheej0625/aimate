/**
 * Read authentication once at the composition root, separately from app config.
 * Pass this snapshot to validation and model factories; never serialize it.
 */
export function loadAiCredentials(env = process.env) {
  return Object.freeze({
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    googleApiKey: env.GOOGLE_GENERATIVE_AI_API_KEY || undefined,
    aiGatewayApiKey:
      env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || undefined,
    openaiCompatibleApiKey: env.OPENAI_COMPATIBLE_API_KEY || undefined,
    xaiApiKey: env.XAI_API_KEY || undefined,
    vertexClientEmail: env.VERTEX_CLIENT_EMAIL || undefined,
    vertexPrivateKey: env.VERTEX_PRIVATE_KEY || undefined,
  });
}
