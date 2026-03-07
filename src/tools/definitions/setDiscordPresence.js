/** @type {import('../ToolRegistry.js').ToolDef} */
export default {
  name: "set_presence_status",
  enabled: true,
  platforms: ["discord"],
  requires: [],

  declaration: {
    name: "set_presence_status",
    description:
      "Discord에서 봇의 온라인 상태를 변경한다. (온라인/방해금지/자리비움/오프라인)",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["online", "dnd", "idle", "invisible"],
          description:
            "설정할 상태. online=온라인, dnd=방해금지, idle=자리비움, invisible=오프라인(숨김)",
        },
      },
      required: ["status"],
    },
  },

  /**
   * @param {{ status: "online" | "dnd" | "idle" | "invisible" }} args
   * @param {{ platformClient: import('discord.js').Client }} ctx
   */
  execute: async (args, ctx) => {
    const client = ctx.platformClient;
    if (!client?.user) {
      return { error: "Discord 클라이언트를 찾을 수 없습니다." };
    }

    const validStatuses = ["online", "dnd", "idle", "invisible"];
    if (!validStatuses.includes(args.status)) {
      return { error: `유효하지 않은 상태입니다: ${args.status}` };
    }

    client.user.setStatus(args.status);

    const labelMap = {
      online: "온라인",
      dnd: "방해금지",
      idle: "자리비움",
      invisible: "오프라인(숨김)",
    };

    return { success: true, status: args.status, label: labelMap[args.status] };
  },
};
