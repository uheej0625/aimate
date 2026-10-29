import { AppEvents } from "../../../core/EventBus.js";
import { createLogger } from "../../../core/logger.js";
import { MessageFlags } from "discord.js";
import {
  buildLogEmbed,
  buildLogFiles,
  buildLogButtons,
  apiTexts,
} from "./logEmbeds.js";

const logger = createLogger("Discord:Logs");
const cardKey = (channelId, id) => JSON.stringify([channelId, id]);

// Persists channel settings; conversation records are only read for display.
export class DiscordLogService {
  constructor({
    client,
    repository,
    eventBus,
    conversationBuffer,
    configManager,
  }) {
    Object.assign(this, {
      client,
      repository,
      eventBus,
      conversationBuffer,
      configManager,
    });
    this.since = new Date();
    this.cards = new Map();
    this.waiting = new Map();
  }

  start() {
    if (this.timer) return;
    this.closed = false;
    this.unsubscribers = [
      AppEvents.GenerationStarted,
      AppEvents.GenerationCompleted,
      AppEvents.GenerationCancelled,
      AppEvents.GenerationFailed,
    ].map((event) =>
      this.eventBus.on(event, () => {
        void this.refresh();
      }),
    );
    this.timer = setInterval(() => {
      void this.refresh();
    }, 1000);
    this.timer.unref();
  }

  refresh() {
    if (this.closed) return Promise.resolve();
    this.refreshing ??= this.sync()
      .catch((error) =>
        logger.warn(
          { event: "discord.log.failed", err: error },
          "Discord log refresh failed",
        ),
      )
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async flush() {
    await this.refreshing;
  }

  async close() {
    clearInterval(this.timer);
    this.timer = null;
    this.unsubscribers?.forEach((unsubscribe) => unsubscribe());
    await this.flush();
    if (this.initialized) await this.refresh();
    this.closed = true;
  }

  async configure({ guildId, channelId, enabled }) {
    if (!guildId || !channelId) {
      throw new Error("Invalid Discord log subscription.");
    }
    await this.repository.configure({ guildId, channelId, enabled });
  }

  async showOriginal(interaction) {
    const match = /^aimate-log:(request|response):(.+)$/.exec(
      interaction.customId,
    );
    if (!match || !interaction.guildId) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [, type, id] = match;
    const record = /^\d+$/.test(id)
      ? await this.repository.generation(Number(id), interaction.guildId)
      : [...this.waiting.values()].find(
          (entry) =>
            entry.record.id === id &&
            entry.channel.server.platformId === interaction.guildId,
        )?.record;
    const value = record ? apiTexts(record)[type] : null;
    if (value == null) {
      await interaction.editReply({
        content: "전문을 찾을 수 없거나 아직 준비되지 않았어요.",
        allowedMentions: { parse: [] },
      });
      return;
    }
    await interaction.editReply({
      files: [
        {
          attachment: Buffer.from(value, "utf8"),
          name: `generation-${id}-api-${type}.txt`,
        },
      ],
    });
  }

  async sync() {
    const subscriptions = await this.repository.destinations();
    this.initialized = true;
    if (!subscriptions.length) {
      this.since = new Date();
      return;
    }
    await this.syncWaiting(subscriptions);
    const records = await this.repository.changes({
      since: this.since,
      guildIds: [...new Set(subscriptions.map((item) => item.guildId))],
    });
    for (const { channel, ...record } of records) {
      await this.deliver(record, channel, subscriptions);
      if (record.updatedAt > this.since) this.since = record.updatedAt;
    }
    for (const entry of this.waiting.values()) {
      if (!entry.cancelled && !this.conversationBuffer.buffers.has(entry.key)) {
        await this.cancelWaiting(entry, subscriptions);
      }
    }
  }

  async syncWaiting(destinations) {
    for (const [key, { turnId }] of this.conversationBuffer.buffers) {
      const [platform, platformId] = JSON.parse(key);
      if (platform !== "discord") continue;
      const createdAt = new Date();
      let entry = this.waiting.get(platformId);
      const channel =
        entry?.channel ?? (await this.repository.sourceChannel(platformId));
      if (
        !channel?.server ||
        !destinations.some((item) => item.guildId === channel.server.platformId)
      )
        continue;
      entry ??= {
        key,
        channel,
        record: {
          id: `waiting:${turnId}`,
          channelId: channel.id,
          type: "CHAT",
          status: "PENDING",
          prompt: this.configManager.get("ai.chat.prompt"),
          characterId: this.configManager.get("character"),
          createdAt,
          updatedAt: createdAt,
        },
      };
      const events = await this.repository.pendingEvents(
        channel.id,
        entry.record.characterId,
      );
      const input = JSON.stringify({
        eventSnapshot: {
          events,
          inputEventIds: events.map((event) => event.id),
        },
      });
      if (entry.record.input !== input) {
        entry.record = { ...entry.record, input, updatedAt: new Date() };
      }
      this.waiting.set(platformId, entry);
      await this.deliver(entry.record, channel, destinations);
    }
  }

  async cancelWaiting(entry, subscriptions) {
    entry.cancelled = true;
    entry.record = {
      ...entry.record,
      status: "CANCELLED",
      updatedAt: new Date(),
    };
    await this.deliver(entry.record, entry.channel, subscriptions);
    this.waiting.delete(entry.channel.platformId);
  }

  async deliver(record, source, destinations) {
    if (source?.platform !== "discord" || !source.server?.platformId) return;
    const pending =
      record.type === "CHAT" && typeof record.id === "number"
        ? this.waiting.get(source.platformId)
        : null;
    const alreadyLogged = destinations.some((destination) =>
      this.cards.has(cardKey(destination.channelId, record.id)),
    );
    const adopt =
      pending && !alreadyLogged && record.createdAt >= pending.record.createdAt;
    if (adopt && !record.input)
      record = { ...record, input: pending.record.input };
    const embed = buildLogEmbed(record, source);
    const components = buildLogButtons(record);
    const signature = JSON.stringify({
      embed: embed.toJSON(),
      components: components.map((row) => row.toJSON()),
    });
    for (const destination of destinations) {
      if (destination.guildId !== source.server.platformId) continue;
      const key = cardKey(destination.channelId, record.id);
      if (adopt) {
        const previousKey = cardKey(destination.channelId, pending.record.id);
        if (this.cards.has(previousKey)) {
          this.cards.set(key, this.cards.get(previousKey));
          this.cards.delete(previousKey);
        }
      }
      const card = this.cards.get(key);
      if (card?.signature === signature) continue;
      try {
        const channel = await this.client.channels.fetch(destination.channelId);
        if (!channel?.isSendable() || channel.guildId !== destination.guildId)
          continue;
        const payload = () => ({
          embeds: [embed],
          components,
          files: buildLogFiles(record),
          attachments: [],
          allowedMentions: { parse: [] },
        });
        if (card) {
          try {
            await channel.messages.edit(card.messageId, payload());
            this.cards.set(key, { ...card, signature });
            continue;
          } catch (error) {
            if (error.code !== 10008) throw error;
          }
        }
        const message = await channel.send(payload());
        this.cards.set(key, { messageId: message.id, signature });
      } catch (error) {
        logger.warn(
          {
            event: "discord.log.failed",
            err: error,
            recordId: record.id,
            logChannelId: destination.channelId,
          },
          "Discord log delivery failed",
        );
      }
    }
    if (adopt) this.waiting.delete(source.platformId);
  }
}
