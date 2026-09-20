/**
 * Platform-neutral message data used by application services.
 *
 * @typedef {Object} NormalizedMessage
 * @property {string} platform
 * @property {string} platformMessageId
 * @property {string} platformChannelId
 * @property {string|null} platformServerId
 * @property {Date|null} editedAt - Platform edit marker/version; not evidence of witnessing an edit.
 * @property {string} content
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
 * @property {symbol} [turnId] - Current in-memory conversation owner
 * @property {number} [rerollGenerationId] - Original fixed input to replay
 * @property {string|null} [cronMessage]
 */

export {};
