import { configManager } from "./config/index.js";
import client from "./platforms/discord/client.js";
import { loadEvents } from "./platforms/discord/handlers/eventHandler.js";
import { loadCommands } from "./platforms/discord/handlers/commandHandler.js";
import { createContainer } from "./core/container.js";
import { registerShutdown } from "./core/shutdown.js";

const main = async () => {
  try {
    console.log("🚀 Starting DiscordMate...");

    // Initialize DI Container
    const container = createContainer(client);

    // Attach services to client for access in events
    client.services = container;

    // Register graceful shutdown
    registerShutdown({
      conversationBuffer: container.conversationBuffer,
      cronService: container.cronService,
      client,
    });

    // Load Events
    await loadEvents(client);

    // Load Commands
    await loadCommands(client);

    // Start CronService
    if (container.cronService) {
      container.cronService.start();
      console.log("⏰ CronService started");
    }

    // Login
    await client.login(configManager.get("secrets.discordToken"));

    console.log("✅ Bot successfully started!");
  } catch (error) {
    console.error("❌ Failed to start bot:", error);
    process.exit(1);
  }
};

main();
