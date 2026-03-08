/**
 * Instagram 이벤트 핸들러 로더
 * events 폴더의 모든 이벤트 파일을 로드하고 RealtimeClient에 등록한다.
 */
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @param {Object} realtime - RealtimeClient 인스턴스
 * @param {Object} context - 이벤트 핸들러에 전달될 컨텍스트
 */
export async function loadEvents(realtime, context) {
  const eventsPath = join(__dirname, "..", "events");
  const eventFiles = readdirSync(eventsPath).filter((file) =>
    file.endsWith(".js"),
  );

  console.log(`📂 Loading ${eventFiles.length} Instagram events...`);

  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    const event = await import(`file://${filePath}`);
    const eventModule = event.default || event;

    const handler = (data) =>
      eventModule
        .execute(data, context)
        .catch((err) =>
          console.error(`[Instagram] Event '${eventModule.name}' error:`, err),
        );

    if (eventModule.once) {
      realtime.once(eventModule.name, handler);
    } else {
      realtime.on(eventModule.name, handler);
    }

    console.log(`  ✅ Loaded event: ${eventModule.name}`);
  }

  console.log("✨ All Instagram events loaded successfully!");
}
