import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadCommands(client) {
  const commandsPath = join(__dirname, "..", "commands");
  const commandFiles = readdirSync(commandsPath).filter((file) =>
    file.endsWith(".js"),
  );

  console.log(`📂 Loading ${commandFiles.length} commands...`);

  for (const file of commandFiles) {
    const filePath = join(commandsPath, file);
    const command = await import(`file://${filePath}`);
    const commandModule = command.default || command;

    if ("data" in commandModule && "execute" in commandModule) {
      client.commands.set(commandModule.data.name, commandModule);
      console.log(`  ✅ Loaded command: ${commandModule.data.name}`);
    } else {
      console.log(
        `  ⚠️  Skipped ${file}: missing required "data" or "execute" property`,
      );
    }
  }

  console.log("✨ All commands loaded successfully!");
}
