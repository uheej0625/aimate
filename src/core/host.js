import { createContainer } from "./container.js";
import { createLogger, withLogContext } from "./logger.js";
const logger = createLogger("Host");
const activeCharacters = new Set();

/** Prepare every identity before opening input; only this owner closes the database. */
export function createHost({
  definitions,
  createCharacter,
  buildRuntime = createContainer,
  disconnectDatabase,
}) {
  const characters = new Map();
  const failures = [];
  let closing,
    started = false;
  const attempt = async (operation) => {
    try {
      await operation();
    } catch (error) {
      logger.error(
        { event: "host.cleanup.failed", err: error },
        "Cleanup failed",
      );
    }
  };
  const host = {
    characters,
    failures,
    async start() {
      if (started) throw new Error("Host already started.");
      started = true;
      if (new Set(definitions.map(({ id }) => id)).size !== definitions.length)
        throw new Error("Duplicate active character ID.");
      for (const definition of definitions) {
        if (closing) break;
        if (activeCharacters.has(definition.id)) {
          failures.push({
            characterId: definition.id,
            error: new Error("Character is already active."),
          });
          continue;
        }
        activeCharacters.add(definition.id);
        let resources;
        try {
          resources = await createCharacter(definition);
          if (closing) {
            for (const connection of resources.connections)
              await attempt(() => connection.close());
            resources.configManager.close();
            activeCharacters.delete(definition.id);
            break;
          }
          const { configManager, connections } = resources;
          if (
            new Set(connections.map(({ platform }) => platform)).size !==
            connections.length
          )
            throw new Error("Duplicate character platform connection.");
          const byPlatform = new Map(
            connections.map((connection) => [connection.platform, connection]),
          );
          const app = await buildRuntime({
            configManager,
            connections: byPlatform,
          });
          if (closing) {
            for (const connection of connections)
              await attempt(() => connection.close());
            configManager.close();
            activeCharacters.delete(definition.id);
            break;
          }
          const entry = { ...resources, app };
          characters.set(definition.id, entry);
          for (const connection of connections) {
            if (closing) break;
            try {
              await withLogContext(
                { characterId: definition.id, platform: connection.platform },
                async () => {
                  await connection.attach(app);
                  await connection.prepare();
                },
              );
            } catch (error) {
              failures.push({
                characterId: definition.id,
                platform: connection.platform,
                error,
              });
              await attempt(() => connection.close());
              connection.state = "failed";
              logger.error(
                {
                  event: "connection.start.failed",
                  characterId: definition.id,
                  platform: connection.platform,
                  err: error,
                },
                "Connection disabled",
              );
            }
          }
        } catch (error) {
          activeCharacters.delete(definition.id);
          failures.push({ characterId: definition.id, error });
          for (const connection of resources?.connections ?? [])
            await attempt(() => connection.close());
          resources?.configManager.close();
          logger.error(
            {
              event: "character.start.failed",
              characterId: definition.id,
              err: error,
            },
            "Character disabled",
          );
        }
      }
      if (closing) return host;
      let active = 0;
      for (const [characterId, entry] of characters) {
        for (const connection of entry.connections) {
          if (closing) break;
          if (connection.state !== "ready") continue;
          try {
            await withLogContext(
              { characterId, platform: connection.platform },
              () => connection.activate(),
            );
            active++;
          } catch (error) {
            failures.push({
              characterId,
              platform: connection.platform,
              error,
            });
            await attempt(() => connection.close());
            connection.state = "failed";
          }
        }
      }
      if (!active) {
        await host.close();
        throw (
          failures[0]?.error ?? new Error("No usable platform connections.")
        );
      }
      logger.info(
        {
          event: "host.started",
          characterCount: characters.size,
          activeConnections: active,
          failedConnections: failures.length,
        },
        "AiMate host started",
      );
      return host;
    },
    async closeConnection(characterId, platform) {
      const entry = characters.get(characterId);
      const connection = entry?.connections.find(
        (item) => item.platform === platform,
      );
      if (!connection) return;
      connection.stopInput();
      await entry.app.closePlatform(platform);
      await connection.close();
    },
    async closeCharacter(characterId) {
      const entry = characters.get(characterId);
      if (!entry) return;
      entry.closing ??= (async () => {
        // Input gates and timers stop synchronously; no network work before abort.
        const stopped = entry.connections.map((connection) =>
          attempt(() => connection.stopInput()),
        );
        await attempt(() => entry.app.close());
        await Promise.all(stopped);
        await Promise.all(
          entry.connections.map((connection) =>
            attempt(() => connection.close()),
          ),
        );
        await attempt(() => entry.configManager.close());
        characters.delete(characterId);
        activeCharacters.delete(characterId);
      })();
      return entry.closing;
    },
    close() {
      closing ??= (async () => {
        await Promise.all(
          [...characters.keys()].map((id) => host.closeCharacter(id)),
        );
        await disconnectDatabase?.();
      })();
      return closing;
    },
  };
  return host;
}
