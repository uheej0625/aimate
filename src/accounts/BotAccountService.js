import { createLogger } from "../core/logger.js";
import { getRequiredCharacterId } from "../character/config.js";

const logger = createLogger("BotAccountService");

/**
 * 봇 플랫폼 계정 초기화 서비스.
 * Discord, CLI 등 모든 플랫폼에서 공통으로 사용한다.
 */
export class BotAccountService {
  /**
   * @param {import('../repositories/PlatformAccountRepository.js').PlatformAccountRepository} platformAccountRepository
   * @param {import('../config/ConfigManager.js').default} configManager
   */
  constructor(platformAccountRepository, configManager) {
    this.platformAccountRepository = platformAccountRepository;
    this.characterId = getRequiredCharacterId(configManager);
  }

  /**
   * 봇의 플랫폼 계정을 초기화(생성 또는 업데이트)한다.
   *
   * @param {Object} options
   * @param {string} options.platform - 플랫폼 이름 ("discord", "cli" 등)
   * @param {string} options.platformId - 플랫폼 내 봇 ID
   * @param {string} [options.handle="DiscordMate_Bot"] - 핸들
   * @param {string} [options.displayName="DiscordMate Bot"] - 표시 이름
   * @returns {Promise<{account: Object, created: boolean}>}
   */
  async initBotAccount({
    platform,
    platformId,
    handle = "DiscordMate_Bot",
    displayName = "DiscordMate Bot",
  }) {
    const { account, created } =
      await this.platformAccountRepository.initCharacterAccount({
        characterId: this.characterId,
        platform,
        platformId,
        handle,
        displayName,
      });

    logger.info(
      {
        event: "bot_account.initialized",
        characterId: this.characterId,
        platform,
        platformUserId: platformId,
        accountId: account.id,
        created,
      },
      "Bot platform account initialized",
    );

    return { account, created };
  }
}
