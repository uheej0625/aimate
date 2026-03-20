/**
 * Instagram 클라이언트 관리
 *
 * IgApiClient 로그인, 세션 관리, RealtimeClient MQTT 연결을 담당한다.
 * useMultiFileAuthState를 사용하여 세션을 파일로 영속화한다.
 */
import pkg from "nodejs-insta-private-api";
const { IgApiClient, RealtimeClient, useMultiFileAuthState } = pkg;
import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("Instagram:Client");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_FOLDER = path.resolve(__dirname, "../../../auth_info_instagram");

/**
 * Instagram API 클라이언트를 초기화하고 MQTT 실시간 연결까지 완료한다.
 *
 * @param {Object} options
 * @param {string} options.username - Instagram 사용자명
 * @param {string} options.password - Instagram 비밀번호
 * @returns {Promise<{ ig: IgApiClient, realtime: RealtimeClient, userId: string }>}
 */
export async function createInstagramClient({ username, password }) {
  const authState = await useMultiFileAuthState(AUTH_FOLDER);
  const ig = new IgApiClient();
  let realtime;

  // 저장된 세션 복원 시도
  if (authState.hasSession()) {
    logger.info("저장된 세션 로드 중...");
    const loaded = await authState.loadCreds(ig);

    if (loaded) {
      const valid = await authState.isSessionValid(ig);

      if (valid) {
        logger.info("세션 유효! MQTT 연결 중...");
        realtime = new RealtimeClient(ig);

        realtime.on("connected", () =>
          logger.info("MQTT Connected"),
        );
        realtime.on("error", (err) =>
          logger.error({ err }, "MQTT Error"),
        );

        await realtime.connectFromSavedSession(authState);

        const me = await ig.account.currentUser();
        const user = me.user || me;
        const userId = String(user.pk || user.id);

        return { ig, realtime, userId };
      }
    }

    logger.info("세션 만료, 새로 로그인합니다...");
    await authState.clearSession();
  }

  // 새 로그인
  logger.info({ username }, "로그인 중...");
  await ig.login({ username, password });
  logger.info("로그인 성공!");

  await authState.saveCreds(ig);

  // 내 계정 정보 조회
  const me = await ig.account.currentUser();
  const user = me.user || me;
  const userId = String(user.pk || user.id);

  // MQTT 연결
  realtime = new RealtimeClient(ig);
  const inbox = await ig.direct.getInbox();

  realtime.on("connected", () => logger.info("MQTT Connected"));
  realtime.on("error", (err) =>
    logger.error({ err }, "MQTT Error"),
  );

  await realtime.connect({
    graphQlSubs: ["ig_sub_direct", "ig_sub_direct_v2_message_sync"],
    skywalkerSubs: ["presence_subscribe", "typing_subscribe"],
    irisData: inbox,
  });

  await authState.saveMqttSession(realtime);
  logger.info("MQTT 세션 저장 완료");

  return { ig, realtime, userId };
}
