import fs from "fs/promises";
import path from "path";

if (process.platform === "win32") {
  try {
    const { execSync } = await import("child_process");
    execSync("chcp 65001", { stdio: "ignore" });
  } catch (e) {}
}

import { input, checkbox, select } from "@inquirer/prompts";
import { fileURLToPath } from "url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 12)) {
  console.error(
    `Error: Node.js v20.12.0 or higher is required. Current: v${process.versions.node}`,
  );
  console.error(
    `오류: Node.js v20.12.0 이상이 필요합니다. 현재: v${process.versions.node}`,
  );
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const locales = {
  en: {
    title: "=== AiMate Environment Setup Wizard ===",
    discordToken: "Enter your DISCORD_TOKEN:",
    discordClientId: "Enter your DISCORD_CLIENT_ID:",
    selectProviders: "Select AI providers you want to configure:",
    openaiKey: "Enter OPENAI_API_KEY:",
    aiGatewayKey: "Enter AI_GATEWAY_API_KEY:",
    googleCloudKey: "Enter GOOGLE_CLOUD_API_KEY:",
    vertexProjectId: "Enter VERTEX_PROJECT_ID:",
    vertexClientEmail: "Enter VERTEX_CLIENT_EMAIL:",
    vertexPrivateKey:
      "Enter VERTEX_PRIVATE_KEY (Use double quotes if it contains newlines):",
    success: "✅ .env file successfully created at:",
    error: "Setup aborted or failed:",
  },
  ko: {
    title: "=== AiMate 환경 설정 마법사 ===",
    discordToken: "DISCORD_TOKEN을 입력하세요:",
    discordClientId: "DISCORD_CLIENT_ID를 입력하세요:",
    selectProviders:
      "설정할 AI 프로바이더를 선택하세요 (스페이스바 선택, 엔터 완료):",
    openaiKey: "OPENAI_API_KEY를 입력하세요:",
    aiGatewayKey: "AI_GATEWAY_API_KEY를 입력하세요:",
    googleCloudKey: "GOOGLE_CLOUD_API_KEY를 입력하세요:",
    vertexProjectId: "VERTEX_PROJECT_ID를 입력하세요:",
    vertexClientEmail: "VERTEX_CLIENT_EMAIL을 입력하세요:",
    vertexPrivateKey:
      "VERTEX_PRIVATE_KEY를 입력하세요 (줄바꿈이 포함된 경우 전체를 큰따옴표로 감싸서 입력):",
    success: "✅ .env 파일이 성공적으로 생성되었습니다:",
    error: "설정이 취소되었거나 실패했습니다:",
  },
};

async function main() {
  const lang = await select({
    message: "Select language / 언어를 선택하세요:",
    choices: [
      { name: "한국어", value: "ko" },
      { name: "English", value: "en" },
    ],
  });

  const t = locales[lang];

  console.log(`\n${t.title}\n`);

  const discordToken = await input({ message: t.discordToken });
  const discordClientId = await input({ message: t.discordClientId });

  const providers = await checkbox({
    message: t.selectProviders,
    choices: [
      { name: "OpenAI", value: "openai" },
      { name: "Vercel AI Gateway", value: "aiGateway" },
      { name: "Google Cloud", value: "googleCloud" },
      { name: "Vertex AI", value: "vertex" },
    ],
    validate: (choices) =>
      choices.length > 0 ||
      (lang === "ko"
        ? "최소 하나의 프로바이더를 선택해주세요."
        : "Please select at least one provider."),
  });

  const envData = {
    DISCORD_TOKEN: discordToken,
    DISCORD_CLIENT_ID: discordClientId,
  };

  if (providers.includes("openai")) {
    envData.OPENAI_API_KEY = await input({ message: t.openaiKey });
  }

  if (providers.includes("aiGateway")) {
    envData.AI_GATEWAY_API_KEY = await input({ message: t.aiGatewayKey });
  }

  if (providers.includes("googleCloud")) {
    envData.GOOGLE_CLOUD_API_KEY = await input({ message: t.googleCloudKey });
  }

  if (providers.includes("vertex")) {
    envData.VERTEX_PROJECT_ID = await input({ message: t.vertexProjectId });
    envData.VERTEX_CLIENT_EMAIL = await input({ message: t.vertexClientEmail });
    envData.VERTEX_PRIVATE_KEY = await input({ message: t.vertexPrivateKey });
  }

  // Generate .env content
  let envString = "# Discord Bot\n";
  envString += `DISCORD_TOKEN=${envData.DISCORD_TOKEN}\n`;
  envString += `DISCORD_CLIENT_ID=${envData.DISCORD_CLIENT_ID}\n\n`;

  if (providers.includes("openai")) {
    envString += "# OpenAI\n";
    envString += `OPENAI_API_KEY=${envData.OPENAI_API_KEY}\n\n`;
  }

  if (providers.includes("aiGateway")) {
    envString += "# Vercel AI Gateway\n";
    envString += `AI_GATEWAY_API_KEY=${envData.AI_GATEWAY_API_KEY}\n\n`;
  }

  if (providers.includes("googleCloud")) {
    envString += "# Google Cloud\n";
    envString += `GOOGLE_CLOUD_API_KEY=${envData.GOOGLE_CLOUD_API_KEY}\n\n`;
  }

  if (providers.includes("vertex")) {
    envString += "# Vertex AI\n";
    envString += `VERTEX_PROJECT_ID=${envData.VERTEX_PROJECT_ID}\n`;
    envString += `VERTEX_CLIENT_EMAIL=${envData.VERTEX_CLIENT_EMAIL}\n`;
    envString += `VERTEX_PRIVATE_KEY=${envData.VERTEX_PRIVATE_KEY}\n\n`;
  }

  envString += "# Prisma DB URL\n";
  envString += 'DATABASE_URL="file:./dev.db"\n';

  const envPath = path.resolve(__dirname, "../.env");

  await fs.writeFile(envPath, envString.trim() + "\n");
  console.log(`\n${t.success}`, envPath);
}

main().catch((err) => {
  console.error(err.message || err);
});
