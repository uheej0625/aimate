import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createLogger, withLogContext } from "../../../core/logger.js";

const logger = createLogger("Discord:EventHandler");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 이벤트 핸들러 로더
 * events 폴더의 모든 이벤트 파일을 로드하고 클라이언트에 등록
 */
export async function loadEvents(client, dependencies = {}) {
  const eventsPath = join(__dirname, "..", "events");
  const eventFiles = readdirSync(eventsPath).filter((file) =>
    file.endsWith(".js"),
  );

  for (const file of eventFiles) {
    const filePath = join(eventsPath, file);
    const event = await import(`file://${filePath}`);
    const eventModule = event.default || event;
    const context = { client, ...dependencies };
    const execute = (...args) => {
      const item = args[0];
      withLogContext(
        {
          platform: "discord",
          platformEvent: eventModule.name,
          platformChannelId: item?.channelId ?? item?.channel?.id,
        },
        async () => eventModule.execute(...args, context),
      ).catch((error) => {
        logger.error(
          {
            err: error,
            event: "platform.event.failed",
            platform: "discord",
            platformChannelId: item?.channelId ?? item?.channel?.id,
            interactionId: item?.commandName ? item.id : undefined,
            platformEvent: eventModule.name,
          },
          "Discord event failed",
        );
      });
    };

    if (eventModule.once) {
      client.once(eventModule.name, execute);
    } else {
      client.on(eventModule.name, execute);
    }
  }

  logger.info(
    { event: "platform.events.loaded", count: eventFiles.length },
    "Events loaded",
  );
}
