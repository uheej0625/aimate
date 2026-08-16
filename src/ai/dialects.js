import { xai } from "@ai-sdk/xai";

const DIALECTS = {
  xai: {
    nativeToolFactories: {
      webSearch(options) {
        return [
          "web_search",
          xai.tools.webSearch(options === true ? {} : options),
        ];
      },
    },
  },
};

function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function supportedAiDialects() {
  return Object.keys(DIALECTS);
}

export function hasEnabledNativeTools(settings) {
  if (settings.nativeTools == null) return false;
  if (!isObjectRecord(settings.nativeTools))
    return Boolean(settings.nativeTools);

  return Object.values(settings.nativeTools).some(Boolean);
}

export function resolveDialect(settings) {
  if (settings.dialect) return settings.dialect;

  if (settings.provider === "gateway") {
    return settings.model?.split("/", 1)[0] || undefined;
  }

  if (settings.provider === "xai") {
    return "xai";
  }

  return undefined;
}

export function validateNativeTools(settings) {
  const nativeTools = settings.nativeTools;

  if (nativeTools == null) return [];
  if (!isObjectRecord(nativeTools)) {
    return ["nativeTools는 객체여야 합니다."];
  }

  const dialectName = resolveDialect(settings);
  const dialect = DIALECTS[dialectName];
  if (!dialect) return [];

  const supportedNames = Object.keys(dialect.nativeToolFactories);
  const unknownNames = Object.keys(nativeTools).filter(
    (name) => !supportedNames.includes(name),
  );

  if (unknownNames.length === 0) return [];

  return [
    `nativeTools에 지원되지 않는 도구가 있습니다: ${unknownNames.join(", ")} ` +
      `(허용값: ${supportedNames.join(", ")})`,
  ];
}

function createNativeTools(dialect, configuredTools) {
  return Object.fromEntries(
    Object.entries(configuredTools ?? {})
      .filter(([, options]) => Boolean(options))
      .map(([name, options]) => dialect.nativeToolFactories[name](options)),
  );
}

export function composeDialectTools({ settings, appTools = {} }) {
  const nativeToolErrors = validateNativeTools(settings);
  if (nativeToolErrors.length > 0) {
    throw new Error(nativeToolErrors.join(" "));
  }

  const needsDialect =
    Boolean(settings.dialect) ||
    hasEnabledNativeTools(settings) ||
    (settings.provider === "xai" && settings.api === "responses");

  if (!needsDialect) {
    return appTools;
  }

  const dialectName = resolveDialect(settings);
  if (!dialectName) {
    if (hasEnabledNativeTools(settings)) {
      throw new Error("Native tools require an AI dialect.");
    }

    return appTools;
  }

  const dialect = DIALECTS[dialectName];
  if (!dialect) {
    throw new Error(`Unsupported AI dialect: ${dialectName}`);
  }

  const nativeTools = createNativeTools(dialect, settings.nativeTools);
  const collisions = Object.keys(nativeTools).filter(
    (name) => name in appTools,
  );

  if (collisions.length > 0) {
    throw new Error(`Duplicate AI tools: ${collisions.join(", ")}`);
  }

  return {
    ...appTools,
    ...nativeTools,
  };
}
