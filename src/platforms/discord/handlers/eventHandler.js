import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 이벤트 핸들러 로더
 * events 폴더의 모든 이벤트 파일을 로드하고 클라이언트에 등록
 */
export async function loadEvents(client) {
  const eventsPath = join(__dirname, "..", "events");
  const eventFiles = readdirSync(eventsPath).filter((file) =>
    file.endsWith(".js"),
  );

  console.log(`📂 Loading ${eventFiles.length} events...`);

  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    const event = await import(`file://${filePath}`);
    const eventModule = event.default || event;

    if (eventModule.once) {
      client.once(eventModule.name, (...args) =>
        eventModule.execute(...args, client),
      );
    } else {
      client.on(eventModule.name, (...args) =>
        eventModule.execute(...args, client),
      );
    }

    console.log(`  ✅ Loaded event: ${eventModule.name}`);
  }

  console.log("✨ All events loaded successfully!");
}
