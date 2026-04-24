import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAIProvider } from "../src/providers/OpenaiProvider.js";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 윈도우 환경 변수에 이미 다른 OPENAI_API_KEY가 설정되어 있다면 그것을 우선하므로,
// override: true 옵션을 주어 무조건 프로젝트의 .env 파일을 덮어쓰도록 강제합니다.
dotenv.config({ path: path.join(__dirname, "../.env"), override: true });

// 테스트를 위한 가짜 ConfigManager
const mockConfigManager = {
  get: (key) => {
    if (key === "ai.image") {
      return { model: "gpt-image-2-2026-04-21" };
    }
    if (key === "secrets.openaiApiKey") {
      return process.env.OPENAI_API_KEY;
    }
    return null;
  },
};

async function testGenerateImage() {
  console.log(process.env.OPENAI_API_KEY);
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ 오류: OPENAI_API_KEY 환경변수가 설정되지 않았습니다.");
    console.error(
      "실행 방법: OPENAI_API_KEY='sk-...' node test-image.js (맥/리눅스) 또는 PowerShell에서 $env:OPENAI_API_KEY='sk-...'; node test-image.js",
    );
    process.exit(1);
  }

  console.log("🚀 OpenAI Provider 초기화 중...");
  const provider = new OpenAIProvider(mockConfigManager, "image");

  const prompt =
    "A children's book drawing of a veterinarian using a stethoscope to listen to the heartbeat of a baby otter.";
  console.log(`\n🎨 이미지 생성 요청 중 (프롬프트: "${prompt}")...`);

  try {
    const startTime = Date.now();
    const imageBuffer = await provider.generateImage(prompt);

    // 파일명 지정 및 저장
    const fileName = "test-otter.png";
    fs.writeFileSync(fileName, imageBuffer);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ 이미지 생성 성공! (${duration}초 소요)`);
    console.log(`📂 저장된 파일: ${fileName}`);
    console.log(`사진을 열어 정상적으로 출력되었는지 확인해 보세요.`);
  } catch (error) {
    console.error("\n❌ 이미지 생성 실패:");
    console.error(error.message);
    if (error.response) {
      console.error(error.response.data);
    }
  }
}

testGenerateImage();
