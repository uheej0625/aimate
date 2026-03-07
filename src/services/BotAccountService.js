/**
 * 봇 플랫폼 계정 초기화 서비스.
 * Discord, CLI 등 모든 플랫폼에서 공통으로 사용한다.
 */
export class BotAccountService {
  /**
   * @param {import('../repositories/UserRepository.js').UserRepository} userRepository
   * @param {import('../repositories/PlatformAccountRepository.js').PlatformAccountRepository} platformAccountRepository
   */
  constructor(userRepository, platformAccountRepository) {
    this.userRepository = userRepository;
    this.platformAccountRepository = platformAccountRepository;
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
    let existing = await this.platformAccountRepository.findByPlatformId(
      platform,
      platformId,
    );

    const created = !existing;

    const userId = existing
      ? existing.userId
      : (await this.userRepository.create()).id;

    const account = await this.platformAccountRepository.upsert({
      platform,
      platformId,
      userId,
      handle,
      displayName,
    });

    console.log(
      `🤖 Bot platform account ${created ? "created" : "updated"}: ${account.id}`,
    );

    return { account, created };
  }
}
