/**
 * Platform-neutral message data used by the application layer.
 *
 * @typedef {Object} NormalizedMessage
 * @property {string} platform
 * @property {string} platformMessageId
 * @property {string} platformChannelId
 * @property {string|null} platformServerId
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
 * Request delivered by a platform adapter to MessageHandler.
 *
 * @typedef {Object} IncomingMessageRequest
 * @property {NormalizedMessage} message
 * @property {ChannelPort} channel
 * @property {string} botId
 */

export {};
