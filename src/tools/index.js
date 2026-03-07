/**
 * 모든 툴 정의를 한 배열로 export한다.
 * 새 툴을 추가할 때는 이 파일에 import를 추가하면 된다.
 */
import getTime from "./definitions/getTime.js";
import setDiscordStatus from "./definitions/setDiscordStatus.js";
import setDiscordPresence from "./definitions/setDiscordPresence.js";
import fetchUrl from "./definitions/fetchUrl.js";
import registerCron from "./definitions/registerCron.js";

export const allTools = [
  getTime,
  setDiscordStatus,
  setDiscordPresence,
  fetchUrl,
  registerCron,
];
