import { AppEvents } from "../../core/EventBus.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("Discord:Policies");

export function registerDiscordPolicies({ eventBus, client, configManager }) {
  eventBus.on(AppEvents.GenerationServiceUnavailable, async () => {
    const fallbackStatus = configManager.get("discord.fallbackStatus") || "dnd";
    await client.user.setStatus(fallbackStatus);
    logger.info({ status: fallbackStatus }, "Bot status changed");
  });
}
