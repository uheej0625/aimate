/** @type {import('../ToolRegistry.js').ToolDef} */
export default {
  name: "set_status_message",
  enabled: true,
  platforms: ["discord"], // Discord 어댑터가 있어야 동작
  requires: [], // 별도 API Key 불필요 (이미 연결된 Discord 클라이언트 사용)

  declaration: {
    name: "set_status_message",
    description: "Discord에서 봇의 상태 메시지(활동 이름)를 변경한다.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "설정할 상태 메시지 텍스트",
        },
        type: {
          type: "string",
          enum: ["PLAYING", "WATCHING", "LISTENING", "COMPETING"],
          description: "Discord 활동 유형. 기본값: PLAYING",
        },
      },
      required: ["message"],
    },
  },

  /**
   * @param {{ message: string, type?: string }} args
   * @param {{ platformClient: import('discord.js').Client }} ctx
   */
  execute: async (args, ctx) => {
    const client = ctx.platformClient;
    if (!client?.user) {
      return { error: "Discord 클라이언트를 찾을 수 없습니다." };
    }

    const activityTypeMap = {
      PLAYING: 0,
      WATCHING: 3,
      LISTENING: 2,
      COMPETING: 5,
    };
    const activityType = activityTypeMap[args.type ?? "PLAYING"] ?? 0;

    client.user.setActivity(args.message, { type: activityType });

    return {
      success: true,
      message: args.message,
      type: args.type ?? "PLAYING",
    };
  },
};
