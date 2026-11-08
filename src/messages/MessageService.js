import { randomUUID } from "node:crypto";
import { getRequiredCharacterId } from "../character/config.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("MessageService");

/**
 * Service for message-related business logic.
 * Handles message persistence including related entities (channel, server, account).
 */
export class MessageService {
  /**
   * @param {import('../repositories/UserRepository.js').UserRepository} userRepository
   * @param {import('../repositories/PlatformAccountRepository.js').PlatformAccountRepository} platformAccountRepository
   * @param {import('../repositories/ChannelRepository.js').ChannelRepository} channelRepository
   * @param {import('../repositories/ServerRepository.js').ServerRepository} serverRepository
   * @param {import('../repositories/MessageRepository.js').MessageRepository} messageRepository
   * @param {import('../repositories/EventRepository.js').EventRepository} eventRepository
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(
    userRepository,
    platformAccountRepository,
    channelRepository,
    serverRepository,
    messageRepository,
    eventRepository,
    configManager,
  ) {
    this.userRepository = userRepository;
    this.platformAccountRepository = platformAccountRepository;
    this.channelRepository = channelRepository;
    this.serverRepository = serverRepository;
    this.messageRepository = messageRepository;
    this.eventRepository = eventRepository;
    this.characterId = getRequiredCharacterId(configManager);
  }

  /**
   * Save a message to the database with all related entities.
   * Automatically creates/updates server, channel, and platform account as needed.
   *
   * @param {import('../application/contracts.js').NormalizedMessage} message
   * @param {number} [generationId] - Optional generation ID to link message to
   * @param {Array} [attachments] - Optional structured attachment metadata
   * @returns {Promise<{message: Object|null, channel: Object, platformAccount: Object, changed: boolean, observedChanged: boolean}>}
   */
  async saveMessage(
    message,
    generationId = null,
    attachments = message.attachments ?? [],
    observation = {},
  ) {
    if (generationId !== null && observation.kind !== "SENT")
      throw new Error(
        "Only confirmed SENT messages can link an output generation.",
      );
    const platform = message.platform;

    // 1. Ensure server exists (if message is in a guild)
    let internalServerId = null;
    if (message.platformServerId) {
      const server = await this.serverRepository.upsert({
        platform: platform,
        platformId: message.platformServerId,
      });
      internalServerId = server.id;
    }

    // 2. Ensure channel exists
    const channel = await this.channelRepository.upsert({
      platform: platform,
      platformId: message.platformChannelId,
      serverId: internalServerId,
    });

    // 3. Find or create platform account
    let platformAccount = await this.platformAccountRepository.findByPlatformId(
      platform,
      message.author.platformUserId,
    );

    const authorCharacterId = platformAccount?.user?.characterId ?? null;
    const userId =
      platformAccount?.userId ?? (await this.userRepository.create()).id;
    platformAccount = await this.platformAccountRepository.upsert({
      platform,
      platformId: message.author.platformUserId,
      userId,
      handle: message.author.handle,
      displayName: message.author.displayName,
    });

    // 4. Save message
    const {
      message: savedMessage,
      changed,
      observedChanged,
    } = await this.recordMessageObservation(
      {
        platform,
        platformId: message.platformMessageId,
        serverId: internalServerId,
        channelId: channel.id,
        authorId: platformAccount.id,
        content: message.content,
        attachmentsJson:
          attachments.length > 0 ? JSON.stringify(attachments) : null,
        generationId,
        editedAt: message.editedAt ?? null,
        sentAt: message.sentAt ?? null,
        isBot: message.author.isBot,
        observationId: message.observationId,
      },
      observation,
    );

    return {
      message: savedMessage,
      channel,
      platformAccount,
      authorCharacterId,
      changed,
      observedChanged,
    };
  }

  async hasStoredMessage(platform, platformMessageId) {
    if (!platformMessageId) return false;
    const message = await this.messageRepository.findByPlatformId(
      platform,
      platformMessageId,
    );
    return !!message && !message.deletedAt;
  }

  async updateMessage(
    message,
    { observed = false, observedAt = new Date(), storedOnly = false } = {},
  ) {
    if (
      storedOnly &&
      !(await this.hasStoredMessage(
        message.platform,
        message.platformMessageId,
      ))
    ) {
      return { message: null, changed: false, observedChanged: false };
    }
    return await this.saveMessage(message, null, undefined, {
      observed,
      observedAt,
      kind: "EDIT",
    });
  }

  /** A read is authorized by the current account's port, never inferred from shared rows. */
  async readRecentHistory(
    channel,
    { before = undefined, canRead = async () => true } = {},
  ) {
    if (!channel.readHistory || !(await canRead())) return 0;
    let messages;
    try {
      messages = await channel.readHistory({ limit: 50, before });
    } catch (error) {
      logger.warn(
        {
          event: "history.read.failed",
          err: error,
          platform: channel.platform,
          platformChannelId: channel.platformChannelId,
        },
        "Could not read platform history",
      );
      return 0;
    }
    let count = 0;
    const unique = [
      ...new Map(
        messages.map((message) => [message.platformMessageId, message]),
      ).values(),
    ];
    for (const message of unique
      .filter((item) => item.platformMessageId !== before)
      .slice(-50)) {
      if (
        message.platform !== channel.platform ||
        message.platformChannelId !== channel.platformChannelId
      ) {
        throw new Error(
          "History snapshot does not belong to the authorized channel.",
        );
      }
      if (!(await canRead())) break;
      await this.saveMessage(message, null, undefined, {
        source: "HISTORY",
        kind: "READ",
      });
      count++;
    }
    return count;
  }

  async deleteMessages(
    platform,
    platformMessageIds,
    channelId = null,
    { observed = false, observedAt = new Date() } = {},
  ) {
    const ids = [...new Set(platformMessageIds)];
    return await this.messageRepository.transaction(async (tx) => {
      const messages =
        await this.messageRepository.findByPlatformIdsInTransaction(
          tx,
          platform,
          ids,
          channelId,
        );
      const deletedMessages = messages.filter((message) => !message.deletedAt);
      if (channelId) {
        for (const id of ids) {
          if (messages.some((message) => message.platformId === id)) continue;
          messages.push(
            await this.messageRepository.rememberDeletion(
              tx,
              platform,
              id,
              channelId,
            ),
          );
        }
      }
      const batchId = ids.length > 1 ? randomUUID() : null;
      const observedMessages = [];
      if (observed) {
        for (const message of messages) {
          const latest = await this.findLatestEvent(tx, message);
          const event = await this.createEvent(tx, {
            ...this.eventIdentity(message),
            kind: "DELETE",
            observationKey: "DELETE",
            // The latest database content may never have been seen.
            snapshotContent: latest?.snapshotContent ?? null,
            snapshotAttachmentsJson: latest?.snapshotAttachmentsJson ?? null,
            generationId: latest?.generationId ?? null,
            batchId,
            observedAt,
          });
          if (event) observedMessages.push(message);
        }
      }
      const deletedCount =
        await this.messageRepository.softDeleteByIdsInTransaction(
          tx,
          deletedMessages.map((message) => message.id),
        );
      return { deletedCount, deletedMessages, observedMessages };
    });
  }

  async deleteMessage(platform, platformMessageId) {
    const { deletedCount } = await this.deleteMessages(platform, [
      platformMessageId,
    ]);
    return deletedCount === 1;
  }

  async deleteMessagesByChannel(channelId) {
    return await this.messageRepository.transaction(async (tx) => {
      const messages =
        await this.messageRepository.findActiveByChannelInTransaction(
          tx,
          channelId,
        );
      return await this.messageRepository.softDeleteByIdsInTransaction(
        tx,
        messages.map((message) => message.id),
      );
    });
  }

  async recordMessageObservation(
    messageData,
    {
      observed = true,
      observedAt = new Date(),
      kind = "READ",
      source = "LIVE",
    } = {},
  ) {
    return await this.messageRepository.transaction(async (tx) => {
      const existing =
        await this.messageRepository.findByPlatformIdInTransaction(
          tx,
          messageData.platform,
          messageData.platformId,
        );
      if (source === "LIVE" && existing?.deletedAt && kind !== "SENT") {
        return { message: existing, changed: false, observedChanged: false };
      }
      let saved = existing;
      let changed = false;
      const { observationId, ...data } = messageData;
      if (
        !existing ||
        (!existing.deletedAt &&
          (kind === "EDIT" || source === "HISTORY") &&
          !isOlder(data, existing) &&
          !sameSnapshot(data, existing))
      ) {
        saved = await this.messageRepository.upsertInTransaction(tx, {
          ...data,
          generationId: existing?.generationId ?? data.generationId,
        });
        changed = true;
      }
      if (kind === "SENT" && existing) {
        if (
          existing.generationId &&
          existing.generationId !== data.generationId
        )
          throw new Error("Output generation ownership conflict.");
        const fillTombstone = !existing.authorId;
        saved = await this.messageRepository.upsertInTransaction(tx, {
          ...data,
          ...(!fillTombstone
            ? {
                content: existing.content,
                attachmentsJson: existing.editedAt
                  ? existing.attachmentsJson
                  : (data.attachmentsJson ?? existing.attachmentsJson),
                editedAt: existing.editedAt,
              }
            : {}),
        });
        changed = fillTombstone || existing.generationId !== data.generationId;
      }
      let event = null;
      if (observed) {
        let observationKey =
          source === "HISTORY" ? null : kind === "READ" ? "CREATE" : kind;
        if (kind === "EDIT") {
          const revision =
            observationId ??
            (data.editedAt && new Date(data.editedAt).toISOString());
          if (!revision && existing && sameSnapshot(data, existing)) {
            return { message: saved, changed, observedChanged: false };
          }
          if (!revision)
            throw new Error(
              "Observed updates require observationId or editedAt.",
            );
          observationKey = `EDIT:${revision}`;
        }
        const latest =
          kind === "EDIT" ? await this.findLatestEvent(tx, saved) : null;
        event = await this.createEvent(tx, {
          ...this.eventIdentity(saved),
          kind,
          source,
          observationKey,
          snapshotContent: messageData.content,
          snapshotAttachmentsJson: messageData.attachmentsJson,
          ...(kind === "EDIT"
            ? { previousContent: latest?.snapshotContent ?? null }
            : {}),
          generationId:
            kind === "SENT" ? messageData.generationId : saved.generationId,
          editedAt: messageData.editedAt,
          observedAt,
        });
      }
      return { message: saved, changed, observedChanged: !!event };
    });
  }

  eventIdentity(message) {
    return {
      channelId: message.channelId,
      messageId: message.id,
      platform: message.platform,
      platformMessageId: message.platformId,
    };
  }

  async findLatestEvent(tx, { platform, platformId }) {
    return await this.eventRepository.findLatestForMessage(tx, {
      characterId: this.characterId,
      platform,
      platformMessageId: platformId,
    });
  }

  async createEvent(tx, eventData) {
    if (
      eventData.observationKey &&
      (await this.eventRepository.findObservation(tx, {
        characterId: this.characterId,
        platform: eventData.platform,
        platformMessageId: eventData.platformMessageId,
        observationKey: eventData.observationKey,
      }))
    )
      return null;
    return await this.eventRepository.create(tx, {
      characterId: this.characterId,
      ...eventData,
    });
  }
}

function sameDate(a, b) {
  return (
    (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null)
  );
}

function isOlder(message, existing) {
  return (
    existing.editedAt &&
    (!message.editedAt || new Date(message.editedAt) < existing.editedAt)
  );
}

function sameSnapshot(a, b) {
  return (
    a.content === b.content &&
    a.attachmentsJson === b.attachmentsJson &&
    sameDate(a.editedAt, b.editedAt)
  );
}
