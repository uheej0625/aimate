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
 * @property {string} [replyToMessageId] - Referenced message in the same channel.
 * @property {string[]} [mentionedUserIds] - Explicit platform user mentions.
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
 * @property {boolean} [isDirect] - One-to-one conversation.
 * @property {(message: OutgoingMessage) => Promise<NormalizedMessage>} send
 * @property {() => Promise<void>} [sendTyping]
 * @property {{maxTextLength: number, attachments: boolean}} constraints - Target transport limits.
 * @property {(options: {limit: number, before?: string}) => Promise<NormalizedMessage[]>} [readHistory] - Authorized account read, oldest first. No implicit shared-cache fallback.
 * @property {(platformMessageId: string) => Promise<NormalizedMessage>} [readMessage] - Read a reply target through this account's channel.
 * @property {(platformMessageId: string, message: OutgoingMessage) => Promise<NormalizedMessage>} [reply]
 * @property {(platformMessageId: string, emoji: string, options?: {abortSignal?: AbortSignal}) => Promise<void>} [react]
 */

/**
 * @typedef {Object} OutgoingMessage
 * @property {string} [content]
 * @property {{path: string, name?: string}[]} [files] - Local files; SDK upload objects belong in adapters.
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
 * @property {string} botId - This connection's authenticated self account ID, independent of isBot.
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

/**
 * A character-owned connection; the runtime derives clients, participants and policy from it.
 * @typedef {Object} PlatformConnection
 * @property {string} platform
 * @property {Object} client
 * @property {string} state
 * @property {Object} [participantSource]
 * @property {(channel: ChannelPort) => boolean|Promise<boolean>} isEnabled
 * @property {(tool: Object, context: Object) => boolean} canUseTool
 * @property {(runtime: Object) => Promise<void>} attach
 * @property {() => Promise<void>} prepare
 * @property {() => Promise<void>} activate
 * @property {() => void} stopInput - Synchronously close input gates and stop timers. Never wait for work here.
 * @property {() => Promise<void>} close - Drain platform work with a deadline, then release transport resources.
 */

export {};
