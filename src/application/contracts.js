/**
 * Platform-neutral message data used by application services.
 *
 * @typedef {Object} NormalizedMessage
 * @property {string} platform
 * @property {string} platformMessageId
 * @property {string} platformChannelId
 * @property {string|null} platformServerId
 * @property {Date|null} sentAt - Original platform send time; never the observation or storage time.
 * @property {Date|null} editedAt - Platform edit marker/version; not evidence of witnessing an edit.
 * @property {string} content
 * @property {Array} [attachments] - Attachment metadata received in this snapshot.
 * @property {string} [observationId] - Stable platform revision/event ID for updates without editedAt.
 * @property {NormalizedAuthor} author
 */

/**
 * @typedef {Object} NormalizedAuthor
 * @property {string} platformUserId
 * @property {string} handle
 * @property {string|null} displayName
 * @property {boolean} isBot
 */

/**
 * Minimal platform channel interface used by chat and message delivery.
 *
 * @typedef {Object} ChannelPort
 * @property {string} platform
 * @property {string} platformChannelId
 * @property {(message: OutgoingMessage) => Promise<NormalizedMessage>} send
 * @property {() => Promise<void>} sendTyping
 * @property {(options: {limit: number, before?: string}) => Promise<NormalizedMessage[]>} [readHistory] - Authorized account read, oldest first. No implicit shared-cache fallback.
 * @property {(platformMessageId: string, message: OutgoingMessage) => Promise<NormalizedMessage>} [reply]
 * @property {(platformMessageId: string, emoji: string, options?: {abortSignal?: AbortSignal}) => Promise<void>} [react]
 */

/**
 * @typedef {Object} OutgoingMessage
 * @property {string} [content]
 * @property {Array} [files]
 */

/**
 * A platform-neutral message event. Hydration is deferred to preserve receive order.
 * @typedef {Object} MessageEvent
 * @property {"CREATE"|"UPDATE"|"DELETE"} kind
 * @property {NormalizedMessage} [message] - CREATE/UPDATE snapshot
 * @property {string} [platformMessageId] - CREATE/UPDATE identity, available before partial hydration
 * @property {() => Promise<NormalizedMessage>} [loadMessage] - Partial platform payload
 * @property {string[]} [platformMessageIds] - DELETE batch
 * @property {ChannelPort} channel
 * @property {string} botId
 */

/**
 * A request to generate a response for one conversation.
 *
 * @typedef {Object} ConversationRequest
 * @property {ChannelPort} channelPort
 * @property {string} internalChannelId
 * @property {string} botId
 * @property {string} [turnId] - UUID identifying the current in-memory conversation owner
 * @property {number} [rerollGenerationId] - Original fixed input to replay
 */

export {};
