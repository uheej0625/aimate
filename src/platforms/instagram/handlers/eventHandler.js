/**
 * Instagram 이벤트 핸들러 로더
 * events 폴더의 모든 이벤트 파일을 로드하고 RealtimeClient에 등록한다.
 */
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createLogger } from "../../../core/logger.js";

const logger = createLogger("Instagram:EventHandler");

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

  logger.info({ count: eventFiles.length }, "📂 Loading Instagram events...");

  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    const event = await import(`file://${filePath}`);
    const eventModule = event.default || event;

    const handler = (data) =>
      eventModule
        .execute(data, context)
        .catch((err) =>
          logger.error({ err, event: eventModule.name }, "Event error"),
        );

    if (eventModule.once) {
      realtime.once(eventModule.name, handler);
    } else {
      realtime.on(eventModule.name, handler);
    }

    logger.info({ event: eventModule.name }, "  ✅ Loaded event");
  }

  logger.info("✨ All Instagram events loaded successfully!");
}
