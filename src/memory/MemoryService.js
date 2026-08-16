/**
 * Loads and formats user memories for chat context injection.
 */
export class MemoryService {
  /**
   * @param {import('../repositories/MemoryRepository.js').MemoryRepository} memoryRepository
   * @param {import('../repositories/UserRepository.js').UserRepository} userRepository
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(memoryRepository, userRepository, configManager) {
    this.memoryRepository = memoryRepository;
    this.userRepository = userRepository;
    this.configManager = configManager;
  }

  isEnabled() {
    return Boolean(this.configManager.get("conversation.enableMemory"));
  }

  /**
   * @param {string|null} platformAccountId
   * @returns {Promise<Array>}
   */
  async loadForPlatformAccount(platformAccountId) {
    if (!this.isEnabled() || !platformAccountId) return [];

    const user = await this.userRepository.findByPlatformAccountId(
      platformAccountId,
    );
    if (!user) return [];

    return await this.memoryRepository.findByUserId(user.id);
  }

  /**
   * @param {Array} memories
   * @returns {string|null}
   */
  formatForContext(memories) {
    if (!memories?.length) return null;

    const lines = memories.map((memory) => `- ${memory.content}`);
    return `[사용자에 대해 기억하는 내용]\n${lines.join("\n")}`;
  }
}
