/** @type {import('../ToolRegistry.js').ToolDef} */
export default {
  name: "get_current_time",
  enabled: true,
  platforms: ["*"], // 모든 플랫폼에서 사용 가능
  requires: [], // 별도 자격증명 불필요

  declaration: {
    name: "get_current_time",
    description: "현재 날짜와 시각을 반환한다. 시간 관련 질문에 사용한다.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },

  /** @param {Object} _args @param {Object} _ctx */
  execute: async (_args, _ctx) => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    };
  },
};
