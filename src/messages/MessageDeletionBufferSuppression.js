/**
 * Marks administrator-initiated deletions so their matching Gateway events do
 * not refresh a conversation buffer.
 */
export class MessageDeletionBufferSuppression {
  constructor() {
    this.entries = new Map();
  }

  suppress(platform, platformMessageIds) {
    const expiresAt = Date.now() + 60_000;
    for (const platformMessageId of platformMessageIds) {
      this.entries.set(this.getKey(platform, platformMessageId), expiresAt);
    }
  }

  consume(platform, platformMessageIds) {
    const now = Date.now();
    const suppressed = new Set();

    for (const platformMessageId of platformMessageIds) {
      const key = this.getKey(platform, platformMessageId);
      const expiresAt = this.entries.get(key);
      this.entries.delete(key);

      if (expiresAt && expiresAt > now) suppressed.add(platformMessageId);
    }

    return suppressed;
  }

  release(platform, platformMessageIds) {
    for (const platformMessageId of platformMessageIds) {
      this.entries.delete(this.getKey(platform, platformMessageId));
    }
  }

  getKey(platform, platformMessageId) {
    return `${platform}:${platformMessageId}`;
  }
}
